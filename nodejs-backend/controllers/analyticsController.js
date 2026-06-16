const AnalyticsEvent = require("../Module/analytics/AnalyticsEvent");

// POST /analytics/event
// Body: { type, page, time_spent }
exports.trackEvent = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { type, page, time_spent, user_name, user_email } = req.body;

    if (!type) return res.status(400).json({ error: "type is required" });

    const event = { type, timestamp: new Date() };
    if (page) event.page = page;
    if (time_spent != null) event.time_spent = time_spent;

    const update = { $push: { events: event } };
    if (user_name) update.$set = { ...update.$set, user_name };
    if (user_email) update.$set = { ...update.$set, user_email };

    await AnalyticsEvent.findOneAndUpdate(
      { user_id },
      update,
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to track event" });
  }
};

// GET /analytics/summary/:user_id
// Summary for ONE user
exports.getUserSummary = async (req, res) => {
  try {
    const doc = await AnalyticsEvent.findOne({ user_id: req.params.user_id });
    if (!doc) return res.json(buildSummary([]));
    const summary = buildSummary([doc]);
    summary.user_id = doc.user_id;
    summary.user_name = doc.user_name || null;
    summary.user_email = doc.user_email || null;
    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch user summary" });
  }
};

// ── helper ────────────────────────────────────────────────────────────────────

function buildSummary(docs) {
  const allEvents = docs.flatMap((d) => d.events);

  // Page views — visits and time spent per page
  const pageMap = {};
  allEvents
    .filter((e) => e.type === "page_view")
    .forEach((e) => {
      if (!pageMap[e.page]) pageMap[e.page] = { page: e.page, visits: 0, total_time_spent: 0 };
      pageMap[e.page].visits += 1;
      pageMap[e.page].total_time_spent += e.time_spent || 0;
    });
  const top_pages = Object.values(pageMap).sort((a, b) => b.total_time_spent - a.total_time_spent);

  return {
    total_users: docs.length,
    top_pages,
  };
}
