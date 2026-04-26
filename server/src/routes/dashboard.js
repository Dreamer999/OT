import { Router } from 'express';
import { db } from '../db.js';
import { authMiddleware } from '../auth.js';

export const dashboardRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

dashboardRouter.get('/', authMiddleware, (req, res) => {
  const userId = req.userId;
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const weekAgo = today - 6 * DAY_MS;
  const monthAgo = now - 30 * DAY_MS;

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS recordings,
      COALESCE(SUM(bytes), 0) AS bytes,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS this_week,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS this_month,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status NOT IN ('analyzed','failed') THEN 1 ELSE 0 END) AS in_flight
    FROM recordings
    WHERE user_id = ? AND deleted_at IS NULL
  `).get(today, weekAgo, monthAgo, userId);

  // Daily counts for last 14 days.
  const start14 = today - 13 * DAY_MS;
  const dailyRows = db.prepare(`
    SELECT created_at FROM recordings
    WHERE user_id = ? AND deleted_at IS NULL AND created_at >= ?
  `).all(userId, start14);
  const buckets = new Map();
  for (let i = 0; i < 14; i++) {
    const d = new Date(start14 + i * DAY_MS);
    d.setHours(0, 0, 0, 0);
    buckets.set(d.getTime(), 0);
  }
  for (const r of dailyRows) {
    const d = new Date(r.created_at); d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    if (buckets.has(k)) buckets.set(k, buckets.get(k) + 1);
  }
  const daily = [...buckets.entries()].map(([ts, count]) => ({ date: ts, count }));

  // Pull recent analyses to derive action items, topics, sentiment.
  const analyses = db.prepare(`
    SELECT a.recording_id, a.action_items_json, a.topics_json, a.sentiment, r.filename, r.created_at
    FROM analyses a
    JOIN recordings r ON r.id = a.recording_id
    WHERE r.user_id = ? AND r.deleted_at IS NULL
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all(userId);

  const action_items = [];
  const topicCounts = new Map();
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const a of analyses) {
    const items = JSON.parse(a.action_items_json || '[]');
    items.forEach((item, idx) => {
      action_items.push({
        recording_id: a.recording_id,
        recording_filename: a.filename,
        recording_created_at: a.created_at,
        index: idx,
        text: item,
      });
    });
    const topics = JSON.parse(a.topics_json || '[]');
    for (const t of topics) {
      const k = String(t).toLowerCase();
      topicCounts.set(k, (topicCounts.get(k) || 0) + 1);
    }
    if (a.sentiment && sentiment[a.sentiment] !== undefined) sentiment[a.sentiment]++;
  }
  const top_topics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([topic, count]) => ({ topic, count }));

  const recent = db.prepare(`
    SELECT id, filename, mime, bytes, status, created_at
    FROM recordings
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 5
  `).all(userId);

  res.json({
    totals,
    daily,
    action_items: action_items.slice(0, 50),
    top_topics,
    sentiment,
    recent,
    server_time: now,
  });
});
