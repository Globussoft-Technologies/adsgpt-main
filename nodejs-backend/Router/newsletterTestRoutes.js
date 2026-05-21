const express = require("express");
const router = express.Router();
const { sendEmail } = require("../services/autopilot/alertService");
const {
  buildDay1Email,
  buildDay2Email,
  buildDay3Email,
  buildDay4Email,
  buildDay5Email,
  buildDay6Email,
  buildDay7Email,
} = require("../controllers/newsletter.controller");

// POST /newsletter-test/send
// Body: { "email": "you@example.com", "firstName": "John" }
router.post("/send", async (req, res) => {
  const { email, firstName = "there" } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "email is required" });
  }

  const emails = [
    { day: 1, ...buildDay1Email(firstName) },
    { day: 2, ...buildDay2Email(firstName) },
    { day: 3, ...buildDay3Email(firstName) },
    { day: 4, ...buildDay4Email(firstName) },
    { day: 5, ...buildDay5Email(firstName) },
    { day: 6, ...buildDay6Email(firstName) },
    { day: 7, ...buildDay7Email(firstName) },
  ];

  const results = [];
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const { day, subject, html } of emails) {
    const result = await sendEmail({ to: email, subject, html });
    results.push({ day, subject, sent: result.sent, reason: result.reason || null, error: result.error || null });
    await delay(500);
  }

  return res.json({ success: true, email, results });
});

module.exports = router;
