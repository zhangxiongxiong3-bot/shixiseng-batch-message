---
name: shixiseng-batch-message
description: Preview and batch-send one fixed recruitment message to Shixiseng employer-side candidates who have applied and are currently waiting for communication.
---

# Shixiseng Batch Message

Use this skill when the user asks to manage Shixiseng employer-side applicant communication, including:

- 查看实习僧待沟通候选人
- 扫描所有投递候选人
- 查看哪些候选人还没发招聘消息
- 预览批量发送
- 开始批量发送
- 给所有未联系候选人发送统一消息
- 继续发送剩余候选人

## Fixed Message

Never rewrite, personalize, translate, summarize, or otherwise alter the outbound message. Every candidate who is sent a message must receive exactly:

```text
你好同学，我们的实习是远程线上进行，我们会为候选人提供专业的培训上岗指导，实习阶段将基于任务交付质量提供报酬，实习期满后我们可以提供公司盖章实习证明，如果有意向可以发一份简历到zhangyiyang1\@jsszzn.cn ，标明“姓名＋面试岗位”
```

## Authorization Boundary

Default to dry-run preview. Do not send unless the latest user message explicitly contains one of:

- `开始批量发送`
- `确认发送`

Even after the user confirms, use the script's explicit send guard. Do not bypass it by editing the script, faking local records, or manually clicking send outside the scripted workflow.

## Workflow

Use Playwright with a persistent browser profile. Open the Shixiseng employer backend and let the user complete login, QR code, SMS, captcha, or other normal account verification manually. Never attempt to solve or bypass verification, slider checks, human checks, account risk controls, or rate limits. If such a challenge appears after login or during batch processing, stop and report it.

Run the automation from this skill directory:

```powershell
npm run open
npm run inspect
npm run dry-run
npm run send -- --confirm-send
```

Use `npm run dry-run` for preview and `npm run send -- --confirm-send` only after explicit user confirmation.

## Deduplication

Before sending to a candidate, the automation must check both:

1. The current chat history contains the exact fixed message.
2. `data/sent_candidates.json` already records this candidate as successfully sent.

If either check is positive, mark the candidate `SKIP`; do not send again.

Each successful send must append or update a local record in `data/sent_candidates.json`:

- `candidate_name`
- `candidate_id`
- `position`
- `send_time`
- `status`

Failed candidates should be written separately to `data/failed_candidates.json` so the remaining work can be resumed.

## Page Adaptation

Do not invent Shixiseng DOM details. First run `npm run inspect` against the real logged-in page and use the saved artifacts under `artifacts/` to verify or adjust selectors. Prefer accessible text, roles, stable attributes, and row-local selectors. Avoid absolute XPath except as a last resort.

Support pagination. A valid scan cannot assume the first page is the whole candidate set.
