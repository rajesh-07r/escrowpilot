# Submission checklist (Render → YouTube → Devpost)

Deadline: **Nov 12, 2026, 3:00 PM EST** (12:00 PM PT). Aim to finish by **Nov 12, 10:00 AM EST**.

## 1. Deploy on Render (about 5 min)
1. Open https://dashboard.render.com and sign in with GitHub (`rajesh-07r`).
2. Click **New + → Blueprint**, pick the repo `rajesh-07r/escrowpilot`, then **Apply**.
3. When Render asks for the secret values, enter:
   - `GEMINI_API_KEY`: your AI Studio key
   - `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`: leave them **empty** to run PayPal in mock mode, or use the US sandbox app if you create one
   - `ANTHROPIC_API_KEY` and `PAYPAL_WEBHOOK_ID`: leave empty
4. Wait for **Live**, about 3–5 minutes. Copy the URL, which looks like `https://escrowpilot-xxxx.onrender.com`.
5. Open it and check that the header badges show `AI: gemini-…`.

The free Render plan sleeps when idle, so the first visit can take about 50 seconds. Open the link once before judges are likely to look.

## 2. Upload the video to YouTube (about 5 min)
1. Go to https://studio.youtube.com, click **Create → Upload video**, and pick `escrowpilot-demo.mp4`.
2. Title: `EscrowPilot – AI agents + PayPal escrow (PayPal AI Hackathon 2026)`
3. For the description, paste the tagline and the GitHub link.
4. Audience: **No, it's not made for kids**.
5. Visibility: **Unlisted** or **Public**. Never **Private**, because judges can't see private videos.
6. Copy the video link.

## 3. Submit on Devpost (about 10 min)
1. Open https://paypalaihackathon.devpost.com, then **Enter a submission / Edit your project**.
2. **Read the Rules tab first.** Check the video length, eligibility, and whether any form fields are required.
3. Fill in:
   - **Project name:** EscrowPilot
   - **Elevator pitch / tagline:** the "Tagline" from `docs/DEVPOST.md`
   - **Story / About:** paste every section of `docs/DEVPOST.md`, from "Inspiration" through "What's next"
   - **Built with:** the tags under "Built with"
   - **Try it out links:** the Render URL and https://github.com/rajesh-07r/escrowpilot
   - **Video demo link:** the YouTube link
   - **Image gallery:** screenshots of the ledger, the deal drawer and the audit trail
4. Opt into **every category** listed at the end of `docs/DEVPOST.md` that the form offers.
5. Click **Submit**. A draft does not count. Check that the project page shows "Submitted".
