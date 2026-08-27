import 'dotenv/config';
import express from 'express';
import realApp from './server.js';

// Demo mode: fake Canvas assignments (no real credentials needed) and an
// instant, always-succeeds photo verifier, so a recorded demo never depends
// on live API rate limits or real school credentials. Everything else
// (task breakdown, panic mode, check-ins, backward planning, real photo
// -> tailored breakdown) still calls Groq for real, unmodified.

const demoApp = express();

const FAKE_ASSIGNMENTS = [
  {
    id: 1,
    course: 'US History',
    name: 'WWI Causes Essay',
    dueAt: '2026-09-05T23:59:00Z',
    url: '#',
    description:
      'Write a 5-paragraph essay on the causes of World War 1. Cite at least 3 primary sources in MLA format. Minimum 1200 words. Submit as a PDF.',
  },
  {
    id: 2,
    course: 'Chemistry',
    name: 'Titration Lab Report',
    dueAt: '2026-09-02T23:59:00Z',
    url: '#',
    description:
      'Summarize the titration lab. Include hypothesis, procedure, a data table, and a conclusion paragraph of at least 300 words.',
  },
  {
    id: 3,
    course: 'English 10',
    name: 'Poetry Explication',
    dueAt: '2026-09-10T23:59:00Z',
    url: '#',
    description:
      'Choose one poem from the provided list and write a 2-page explication covering tone, imagery, and structure.',
  },
];

demoApp.post('/api/canvas/assignments', express.json(), (req, res) => {
  res.json({ assignments: FAKE_ASSIGNMENTS });
});

demoApp.post('/api/verify-photo', express.json({ limit: '8mb' }), (req, res) => {
  const { stepTitle } = req.body || {};
  res.json({
    confirmed: true,
    message: `Looks done, nice work on "${stepTitle || 'that step'}".`,
  });
});

demoApp.use(realApp);

const PORT = process.env.DEMO_PORT || 3001;
demoApp.listen(PORT, () =>
  console.log(`TaskBreaker DEMO mode (fake Canvas assignments + instant photo verify) on http://localhost:${PORT}`)
);
