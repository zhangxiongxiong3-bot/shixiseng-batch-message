import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_DIR = path.join(ROOT, '.profile', 'chromium');
const BROWSERS_DIR = path.join(ROOT, '.playwright-browsers');
const DATA_DIR = path.join(ROOT, 'data');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const SENT_PATH = path.join(DATA_DIR, 'sent_candidates.json');
const FAILED_PATH = path.join(DATA_DIR, 'failed_candidates.json');
const BASE_URL = process.env.SHIXISENG_START_URL || 'https://hr.shixiseng.com/join';

const FIXED_MESSAGE =
  '你好同学，我们的实习是远程线上进行，我们会为候选人提供专业的培训上岗指导，实习阶段将基于任务交付质量提供报酬，实习期满后我们可以提供公司盖章实习证明，如果有意向可以发一份简历到zhangyiyang1\\@jsszzn.cn ，标明“姓名＋面试岗位”';

const NEED_COMMUNICATION_KEYWORDS = [
  '待沟通',
  '未沟通',
  '新投递',
  '待处理',
  '待联系',
  '已投递',
  '申请职位'
];

const STOP_KEYWORDS = [
  '滑块',
  '人机验证',
  '安全验证',
  '账号风险',
  '访问频率',
  '操作频繁',
  '风控',
  '请完成验证'
];

const LOGIN_KEYWORDS = ['登录', '验证码登录', '密码登录', '微信扫一扫', '获取短信验证码'];

const CHAT_ENTRY_TEXTS = [
  '沟通',
  '立即沟通',
  '去沟通',
  '联系',
  '聊一聊',
  '发消息',
  '回复',
  '查看沟通'
];

const SEND_TEXTS = ['发送', 'Send'];
const NEXT_PAGE_TEXTS = ['下一页', '下页', '>', '›'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomDelay(min = 2500, max = 6500) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeMessage(value) {
  return cleanText(value).replace(/\\@/g, '@');
}

function messageAlreadyPresent(historyText) {
  const history = cleanText(historyText);
  return history.includes(FIXED_MESSAGE) || normalizeMessage(history).includes(normalizeMessage(FIXED_MESSAGE));
}

function stableHash(value) {
  let hash = 5381;
  for (const char of String(value || '')) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  await ensureJsonArray(SENT_PATH);
  await ensureJsonArray(FAILED_PATH);
}

async function ensureJsonArray(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '[]\n', 'utf8');
  }
}

async function readJsonArray(filePath) {
  await ensureJsonArray(filePath);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON array`);
  return parsed;
}

async function writeJsonArray(filePath, records) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

function sentKey(candidate) {
  return [
    candidate.candidate_id || '',
    candidate.candidate_name || '',
    candidate.position || ''
  ].join('|');
}

async function loadSentMap() {
  const rows = await readJsonArray(SENT_PATH);
  return new Map(rows.filter((row) => row.status === 'sent').map((row) => [sentKey({
    candidate_id: row.candidate_id,
    candidate_name: row.candidate_name,
    position: row.position
  }), row]));
}

async function recordSent(candidate) {
  const rows = await readJsonArray(SENT_PATH);
  const key = sentKey(candidate);
  const next = rows.filter((row) => sentKey({
    candidate_id: row.candidate_id,
    candidate_name: row.candidate_name,
    position: row.position
  }) !== key);
  next.push({
    candidate_name: candidate.candidate_name,
    candidate_id: candidate.candidate_id,
    position: candidate.position,
    send_time: nowIso(),
    status: 'sent'
  });
  await writeJsonArray(SENT_PATH, next);
}

async function recordFailed(candidate, reason) {
  const rows = await readJsonArray(FAILED_PATH);
  rows.push({
    candidate_name: candidate.candidate_name,
    candidate_id: candidate.candidate_id,
    position: candidate.position,
    time: nowIso(),
    status: 'failed',
    reason: String(reason || 'unknown error').slice(0, 500)
  });
  await writeJsonArray(FAILED_PATH, rows);
}

async function launchBrowser() {
  await ensureDirs();
  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 950 },
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  return { context, page };
}

async function gotoBackend(page) {
  if (!page.url() || page.url() === 'about:blank') {
    await page.goto(BASE_URL, { waitUntil: 'commit', timeout: 60000 }).catch(async (error) => {
      console.warn(`Navigation warning: ${error.message}`);
      await sleep(3000);
    });
  }
}

async function getBodyText(page) {
  return cleanText(await page.locator('body').innerText({ timeout: 5000 }).catch(() => ''));
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

async function detectStopCondition(page, phase) {
  const text = await getBodyText(page);
  if (containsAny(text, STOP_KEYWORDS)) {
    throw new Error(`STOP_RISK: ${phase} saw verification/risk-control text. Manual review required.`);
  }
}

async function waitForManualLogin(page) {
  await gotoBackend(page);
  console.log(`Opened ${BASE_URL}`);
  console.log('If Shixiseng asks for login, QR, SMS, or captcha, complete it manually in the opened browser.');
  console.log('This script will wait for a non-login employer page for up to 10 minutes.');

  const deadline = Date.now() + 10 * 60 * 1000;
  let lastSnapshot = 0;
  while (Date.now() < deadline) {
    const text = await getBodyText(page);
    const url = page.url();
    const clickableCount = await page.locator('a,button,input,textarea,[role="button"],[contenteditable="true"]').count().catch(() => 0);
    if (Date.now() - lastSnapshot > 30000) {
      lastSnapshot = Date.now();
      await saveInspection(page, 'login-wait').catch(() => {});
      console.log(`Waiting for login/page readiness. url=${url}, textLength=${text.length}, controls=${clickableCount}`);
    }
    if (!text && clickableCount === 0) {
      await sleep(3000);
      continue;
    }
    if (url.includes('hr.shixiseng.com') && text && !containsAny(text, LOGIN_KEYWORDS)) {
      console.log(`Login/session appears usable. Current URL: ${url}`);
      return;
    }
    await sleep(3000);
  }

  throw new Error('Login wait timed out. Run npm run open again after completing login.');
}

async function saveInspection(page, label = 'inspect') {
  await ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = path.join(ARTIFACTS_DIR, `${stamp}-${label}`);
  const bodyText = await getBodyText(page);
  const url = page.url();
  const clickable = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('a,button,[role="button"],input,textarea,[contenteditable="true"],[tabindex]'));
    return nodes.slice(0, 250).map((el, index) => {
      const rect = el.getBoundingClientRect();
      return {
        index,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        href: el.getAttribute('href') || '',
        role: el.getAttribute('role') || '',
        aria: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        className: typeof el.className === 'string' ? el.className.slice(0, 180) : '',
        id: el.id || '',
        dataId: el.getAttribute('data-id') || el.getAttribute('data-resume-id') || el.getAttribute('data-candidate-id') || '',
        visible: rect.width > 0 && rect.height > 0,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
      };
    });
  });
  await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${prefix}.json`, JSON.stringify({ url, bodyText, clickable }, null, 2), 'utf8');
  await fs.writeFile(`${prefix}.txt`, `${url}\n\n${bodyText}\n`, 'utf8');
  console.log(`Saved inspection artifacts: ${prefix}.json / .txt / .png`);
}

async function clickFirstVisibleText(page, texts, timeout = 2500) {
  for (const text of texts) {
    const locators = [
      page.getByRole('link', { name: new RegExp(escapeRegExp(text)) }),
      page.getByRole('button', { name: new RegExp(escapeRegExp(text)) }),
      page.locator(`text=${text}`)
    ];
    for (const locator of locators) {
      const first = locator.first();
      if (await first.isVisible({ timeout }).catch(() => false)) {
        await first.click();
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await sleep(1200);
        return true;
      }
    }
  }
  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function navigateToCandidates(page) {
  await gotoBackend(page);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const routeTexts = [
    ['候选人'],
    ['投递管理'],
    ['简历管理'],
    ['沟通'],
    ['待沟通'],
    ['新投递']
  ];

  for (const texts of routeTexts) {
    await clickFirstVisibleText(page, texts, 1200).catch(() => false);
  }

  await sleep(2000);
  await detectStopCondition(page, 'navigation');
}

async function extractCandidateRows(page) {
  return await page.evaluate((needKeywords) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const hasNeedKeyword = (text) => needKeywords.some((keyword) => text.includes(keyword));
    const rowSelectors = [
      '[data-candidate-id]',
      '[data-resume-id]',
      '[data-application-id]',
      '.candidate',
      '.resume',
      '.deliver',
      '.apply',
      '.list-item',
      '.table-row',
      '.ant-table-row',
      'tr'
    ];

    const nodes = [];
    for (const selector of rowSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!nodes.includes(el) && isVisible(el)) nodes.push(el);
      }
    }

    if (nodes.length === 0) {
      const broad = Array.from(document.querySelectorAll('main li, .content li, section li, main div, .content div'))
        .filter((el) => isVisible(el) && clean(el.innerText).length > 12 && clean(el.innerText).length < 900);
      nodes.push(...broad.slice(0, 120));
    }

    const result = [];
    const seen = new Set();
    for (const el of nodes) {
      const text = clean(el.innerText || el.textContent);
      if (!text || text.length < 8 || text.length > 1200) continue;
      const actionText = Array.from(el.querySelectorAll('a,button,[role="button"]'))
        .map((node) => clean(node.innerText || node.textContent || node.getAttribute('aria-label')))
        .join(' ');
      const looksCandidate = hasNeedKeyword(text) || /沟通|联系|回复|简历|投递|岗位|职位/.test(text + actionText);
      if (!looksCandidate) continue;

      const id =
        el.getAttribute('data-candidate-id') ||
        el.getAttribute('data-resume-id') ||
        el.getAttribute('data-application-id') ||
        el.querySelector('[data-candidate-id]')?.getAttribute('data-candidate-id') ||
        el.querySelector('[data-resume-id]')?.getAttribute('data-resume-id') ||
        '';
      const link = el.querySelector('a[href]')?.getAttribute('href') || '';
      const lines = text.split(/(?<=\S)\s+(?=\S)/).map(clean).filter(Boolean);
      const name =
        el.querySelector('[class*="name" i]')?.textContent ||
        el.querySelector('[data-name]')?.getAttribute('data-name') ||
        lines.find((line) => /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s·.]{1,20}$/.test(line)) ||
        lines[0] ||
        '未知候选人';
      const position =
        el.querySelector('[class*="position" i], [class*="job" i], [class*="post" i]')?.textContent ||
        lines.find((line) => /实习|岗位|职位|工程师|运营|设计|产品|数据|AI|算法|开发|助理/.test(line)) ||
        '';
      const status =
        lines.find((line) => /待沟通|未沟通|新投递|待处理|待联系|已投递|已沟通|不合适|面试/.test(line)) ||
        '';
      const fingerprint = `${id}|${link}|${name}|${position}|${text.slice(0, 80)}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      result.push({
        candidate_name: clean(name),
        candidate_id: clean(id || link || ''),
        position: clean(position),
        current_status: clean(status),
        row_text: text.slice(0, 700),
        action_text: actionText.slice(0, 300)
      });
    }
    return result;
  }, NEED_COMMUNICATION_KEYWORDS);
}

async function candidatesFromCurrentPage(page) {
  const raw = await extractCandidateRows(page);
  return raw
    .map((candidate) => ({
      ...candidate,
      candidate_id: candidate.candidate_id || stableHash(`${candidate.candidate_name}|${candidate.position}|${candidate.row_text}`)
    }))
    .filter((candidate) => isInScope(candidate));
}

function isInScope(candidate) {
  const text = `${candidate.current_status} ${candidate.row_text} ${candidate.action_text}`;
  return NEED_COMMUNICATION_KEYWORDS.some((keyword) => text.includes(keyword));
}

async function openCandidateChat(page, candidate) {
  const row = page.locator('body').locator(`text=${candidate.candidate_name}`).first();
  if (await row.isVisible({ timeout: 2000 }).catch(() => false)) {
    const candidateContainer = row.locator('xpath=ancestor-or-self::*[self::tr or contains(@class,"item") or contains(@class,"row") or contains(@class,"card")][1]');
    if (await candidateContainer.count().catch(() => 0)) {
      for (const text of CHAT_ENTRY_TEXTS) {
        const button = candidateContainer.getByText(text, { exact: false }).first();
        if (await button.isVisible({ timeout: 1200 }).catch(() => false)) {
          await button.click();
          await sleep(1800);
          return true;
        }
      }
    }
  }

  for (const text of CHAT_ENTRY_TEXTS) {
    const clicked = await clickFirstVisibleText(page, [text], 1200);
    if (clicked) return true;
  }

  return false;
}

async function getChatHistoryText(page) {
  const candidates = [
    '[class*="chat" i]',
    '[class*="message" i]',
    '[class*="im" i]',
    '[class*="dialog" i]',
    '[role="dialog"]',
    'body'
  ];
  for (const selector of candidates) {
    const locator = page.locator(selector).last();
    if (await locator.isVisible({ timeout: 800 }).catch(() => false)) {
      const text = await locator.innerText({ timeout: 2000 }).catch(() => '');
      if (cleanText(text)) return cleanText(text);
    }
  }
  return await getBodyText(page);
}

async function findMessageInput(page) {
  const selectors = [
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    'input:not([disabled])[type="text"]',
    '[role="textbox"]'
  ];
  for (const selector of selectors) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i -= 1) {
      const locator = locators.nth(i);
      if (await locator.isVisible({ timeout: 800 }).catch(() => false)) return locator;
    }
  }
  return null;
}

async function fillMessage(page) {
  const input = await findMessageInput(page);
  if (!input) throw new Error('message input not found');

  await input.click();
  const tagName = await input.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  const editable = await input.evaluate((el) => el.getAttribute('contenteditable') === 'true').catch(() => false);
  if (editable) {
    await input.evaluate((el) => {
      el.textContent = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    });
    await input.type(FIXED_MESSAGE, { delay: 8 });
  } else if (tagName === 'textarea' || tagName === 'input') {
    await input.fill(FIXED_MESSAGE);
  } else {
    await input.type(FIXED_MESSAGE, { delay: 8 });
  }
}

async function clickSend(page) {
  for (const text of SEND_TEXTS) {
    const button = page.getByRole('button', { name: new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`) }).last();
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click();
      await sleep(1200);
      return true;
    }
  }

  const textButton = page.locator('button, [role="button"]').filter({ hasText: /^发送$/ }).last();
  if (await textButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await textButton.click();
    await sleep(1200);
    return true;
  }

  return false;
}

async function closeChatIfNeeded(page) {
  const closeButtons = [
    page.getByRole('button', { name: /关闭|取消|返回/ }).first(),
    page.locator('[aria-label="Close"], [aria-label="关闭"], .close, .ant-modal-close').first()
  ];
  for (const button of closeButtons) {
    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await button.click().catch(() => {});
      await sleep(800);
      return;
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(500);
}

async function scanPage(page, sentMap, mode) {
  const candidates = await candidatesFromCurrentPage(page);
  const results = [];

  for (const candidate of candidates) {
    const localSent = sentMap.has(sentKey(candidate));
    let chatSent = false;
    let action = localSent ? 'SKIP' : 'PLAN_SEND';

    if (!localSent) {
      const opened = await openCandidateChat(page, candidate);
      if (!opened) {
        action = 'FAILED_OPEN_CHAT';
        results.push({ ...candidate, already_sent: false, action });
        await recordFailed(candidate, 'chat entry not found');
        continue;
      }

      await detectStopCondition(page, `chat ${candidate.candidate_name}`);
      const history = await getChatHistoryText(page);
      chatSent = messageAlreadyPresent(history);

      if (chatSent) {
        action = 'SKIP';
      } else if (mode === 'send' || mode === 'resume') {
        await fillMessage(page);
        const sent = await clickSend(page);
        if (!sent) {
          action = 'FAILED_SEND_BUTTON';
          await recordFailed(candidate, 'send button not found');
        } else {
          await recordSent(candidate);
          sentMap.set(sentKey(candidate), candidate);
          action = 'SENT';
        }
      }

      await closeChatIfNeeded(page);
      await sleep(randomDelay());
    }

    results.push({
      ...candidate,
      already_sent: localSent || chatSent,
      action
    });
  }

  return results;
}

async function clickNextPage(page) {
  for (const text of NEXT_PAGE_TEXTS) {
    const locators = [
      page.getByRole('button', { name: new RegExp(escapeRegExp(text)) }).last(),
      page.getByRole('link', { name: new RegExp(escapeRegExp(text)) }).last(),
      page.locator(`text=${text}`).last()
    ];
    for (const locator of locators) {
      if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
        const disabled = await locator.evaluate((el) => {
          return el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            /disabled/.test(String(el.className || ''));
        }).catch(() => false);
        if (disabled) continue;
        await locator.click();
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await sleep(1800);
        return true;
      }
    }
  }
  return false;
}

async function runBatch(mode) {
  const { context, page } = await launchBrowser();
  try {
    await waitForManualLogin(page);
    await navigateToCandidates(page);
    await saveInspection(page, 'before-scan');

    const sentMap = await loadSentMap();
    const allResults = [];
    const seenPages = new Set();
    const maxPages = Number(process.env.SHIXISENG_MAX_PAGES || 50);

    for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
      await detectStopCondition(page, `page ${pageIndex}`);
      const pageFingerprint = stableHash(`${page.url()}|${(await getBodyText(page)).slice(0, 1000)}`);
      if (seenPages.has(pageFingerprint)) break;
      seenPages.add(pageFingerprint);

      console.log(`Scanning page ${pageIndex}...`);
      const pageResults = await scanPage(page, sentMap, mode);
      allResults.push(...pageResults);

      const moved = await clickNextPage(page);
      if (!moved) break;
      await sleep(randomDelay(1800, 4200));
    }

    await writeJsonArray(path.join(DATA_DIR, mode === 'dry-run' ? 'dry_run_results.json' : 'last_run_results.json'), allResults);
    printSummary(allResults);
    return allResults;
  } finally {
    await context.close();
  }
}

function printSummary(results) {
  const total = results.length;
  const already = results.filter((row) => row.already_sent || row.action === 'SKIP').length;
  const sent = results.filter((row) => row.action === 'SENT').length;
  const planned = results.filter((row) => row.action === 'PLAN_SEND').length;
  const failed = results.filter((row) => row.action.startsWith('FAILED')).length;

  console.log('');
  console.log('候选人预览/处理结果');
  for (const row of results) {
    const status = row.already_sent || row.action === 'SKIP' ? '已发送' : '未发送';
    console.log(`${row.candidate_name} | ${row.position || '未知岗位'} | ${status} | ${row.action}`);
  }

  console.log('');
  console.log(`候选人数量: ${total}`);
  console.log(`已发送数量: ${already + sent}`);
  console.log(`待发送数量: ${planned}`);
  console.log(`本次成功发送: ${sent}`);
  console.log(`失败数量: ${failed}`);
  if (failed > 0) {
    console.log(`失败详情已记录: ${FAILED_PATH}`);
  }
}

function requireSendConfirmation(mode) {
  if (mode !== 'send' && mode !== 'resume') return;
  if (!process.argv.includes('--confirm-send')) {
    throw new Error('Formal send mode requires --confirm-send. Do not use it unless the user explicitly said 开始批量发送 or 确认发送.');
  }
}

async function main() {
  const mode = process.argv[2] || 'dry-run';
  if (!['open', 'inspect', 'dry-run', 'send', 'resume'].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}`);
  }
  requireSendConfirmation(mode);

  const { context, page } = mode === 'open' || mode === 'inspect' ? await launchBrowser() : { context: null, page: null };
  try {
    if (mode === 'open') {
      await waitForManualLogin(page);
      await saveInspection(page, 'open');
      console.log('Browser profile saved. You can close the browser when finished.');
      await sleep(5000);
      return;
    }

    if (mode === 'inspect') {
      await waitForManualLogin(page);
      await navigateToCandidates(page);
      await saveInspection(page, 'inspect');
      const sentMap = await loadSentMap();
      const candidates = await candidatesFromCurrentPage(page);
      const preview = candidates.map((candidate) => ({
        ...candidate,
        local_sent: sentMap.has(sentKey(candidate))
      }));
      await fs.writeFile(path.join(ARTIFACTS_DIR, 'candidate-preview.json'), JSON.stringify(preview, null, 2), 'utf8');
      console.log(`Candidate-like rows found on current page: ${preview.length}`);
      for (const row of preview) {
        console.log(`${row.candidate_name} | ${row.position || '未知岗位'} | ${row.current_status || '未知状态'} | ${row.local_sent ? 'LOCAL_SENT' : 'UNKNOWN'}`);
      }
      await sleep(5000);
      return;
    }
  } finally {
    if (context) await context.close();
  }

  await runBatch(mode);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
