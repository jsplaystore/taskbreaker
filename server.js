import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TEXT_MODEL = 'openai/gpt-oss-20b';
const VISION_MODEL = 'qwen/qwen3.6-27b';

async function callGroq(messages, { model = TEXT_MODEL, json = true, maxTokens } = {}, retriesLeft = 2) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (res.status === 429 && retriesLeft > 0) {
    const text = await res.text();
    const wait = Number(text.match(/try again in ([\d.]+)s/)?.[1]) || 5;
    await new Promise((r) => setTimeout(r, Math.min(wait, 20) * 1000 + 300));
    return callGroq(messages, { model, json, maxTokens }, retriesLeft - 1);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

function extractJson(text) {
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : withoutThink;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model output');
  return JSON.parse(candidate.slice(start, end + 1));
}

function stripHtml(html, maxLength = 2000) {
  if (!html) return '';
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

async function getJson(messages, opts, parser = JSON.parse) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const content = await callGroq(messages, opts);
    try {
      return parser(content);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function imageContent(text, imageBase64, mimeType) {
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` } },
  ];
}

const ENERGY_GUIDANCE = {
  low: 'The person has LOW energy/focus right now. Make steps extra small (2-8 min), start with something almost absurdly easy, and keep the total list short.',
  medium: 'The person has MEDIUM energy/focus right now. Normal-sized steps are fine (2-15 min).',
  high: 'The person has HIGH energy/focus right now. You can use slightly bigger steps (up to 20-25 min) and be a bit more ambitious with scope.',
};

const BREAKDOWN_SYSTEM = `You help people with ADHD/executive function challenges turn a vague, overwhelming task into a short list of tiny, concrete, startable steps.

Rules:
- Steps must be concrete physical/mental actions, not vague ("open the document and write one bad sentence" not "start writing").
- Each step should be small enough to plausibly finish in the estimated time. Never estimate more than 25 minutes for one step.
- 3 to 8 steps total. Fewer, well-sized steps beat many tiny ones.
- The first step must be a trivially easy "entry point" step to beat blank-page/start paralysis.
- No motivational fluff, no explanations of why, just the steps.
- Never use em dashes in any text you write.
- If assignment details are provided, mine them for every concrete requirement (word or page count, number of sources or citation style, required sections, formatting, submission format) and work each one explicitly into a step title or its "why" instead of writing generic steps. A step referencing "1200 words" or "MLA citations" is much better than a generic "write body paragraph".
- Respond ONLY with JSON: {"steps": [{"title": string, "minutes": number, "why": string (max 12 words, optional concrete tip)}]}`;

app.post('/api/breakdown', async (req, res) => {
  try {
    const { task, minutesAvailable, energy, context } = req.body;
    if (!task || typeof task !== 'string' || !task.trim()) {
      return res.status(400).json({ error: 'task is required' });
    }
    let userMsg = `Task: "${task}"`;
    if (context) userMsg += `\nAssignment details (from Canvas/Classroom): "${context}"`;
    if (minutesAvailable) userMsg += `\nI have about ${minutesAvailable} minutes total right now.`;
    if (energy && ENERGY_GUIDANCE[energy]) userMsg += `\n${ENERGY_GUIDANCE[energy]}`;
    res.json(
      await getJson([
        { role: 'system', content: BREAKDOWN_SYSTEM },
        { role: 'user', content: userMsg },
      ])
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const IMAGE_BREAKDOWN_SYSTEM = `Think briefly (a few short sentences max) before answering, then output the JSON. You help people with ADHD/executive function challenges turn an overwhelming physical task into tiny, concrete steps, using a PHOTO of the actual space/item as your source of truth.

Rules:
- Look at the photo carefully and reference SPECIFIC visible things (e.g. "the pile of clothes on the chair", "the stack of papers on the left side of the desk", "the dishes in the sink") instead of generic steps.
- Steps must be concrete actions completable in the estimated time. Never more than 25 minutes per step.
- 3 to 8 steps, ordered by what's easiest/closest first.
- The first step must be a trivially easy "entry point" step.
- No motivational fluff, just the steps.
- Never use em dashes in any text you write.
- Respond ONLY with JSON: {"steps": [{"title": string, "minutes": number, "why": string (max 12 words)}], "sceneNotes": string (1 sentence describing what you saw)}`;

app.post('/api/breakdown-from-image', async (req, res) => {
  try {
    const { task, imageBase64, mimeType, minutesAvailable, energy } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });
    let prompt = task
      ? `The overall task is: "${task}". Here is a photo of the actual space/item.`
      : `Here is a photo of the space/item that needs dealing with. Infer the task from what you see.`;
    if (minutesAvailable) prompt += ` I have about ${minutesAvailable} minutes.`;
    if (energy && ENERGY_GUIDANCE[energy]) prompt += ` ${ENERGY_GUIDANCE[energy]}`;
    res.json(
      await getJson(
        [
          { role: 'system', content: IMAGE_BREAKDOWN_SYSTEM },
          { role: 'user', content: imageContent(prompt, imageBase64, mimeType) },
        ],
        { model: VISION_MODEL, json: false, maxTokens: 1400 },
        extractJson
      )
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const VERIFY_SYSTEM = `Think briefly (a few short sentences max) before answering, then output the JSON. You are checking whether a "before/in-progress" step was actually completed, using an "after" photo the user just took.

You will be told what the step was supposed to be. Look at the photo and judge whether it plausibly shows that step done (be generous and encouraging, you're not a strict grader, you're building momentum). If the photo clearly shows no relevant progress (e.g. random unrelated photo), say so gently. Never use em dashes.

Respond ONLY with JSON: {"confirmed": boolean, "message": string (max 20 words, warm and specific to what you see)}`;

app.post('/api/verify-photo', async (req, res) => {
  try {
    const { stepTitle, imageBase64, mimeType } = req.body;
    if (!stepTitle || !imageBase64) return res.status(400).json({ error: 'stepTitle and imageBase64 are required' });
    res.json(
      await getJson(
        [
          { role: 'system', content: VERIFY_SYSTEM },
          {
            role: 'user',
            content: imageContent(`The step was: "${stepTitle}". Here is the after-photo.`, imageBase64, mimeType),
          },
        ],
        { model: VISION_MODEL, json: false, maxTokens: 1400 },
        extractJson
      )
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const EXTRACT_SYSTEM = `Think briefly (a few short sentences max) before answering, then output the JSON. You extract an assignment/task and its deadline from a screenshot (email, syllabus, LMS page, handwritten note, etc).

Respond ONLY with JSON: {"task": string (concise description of what needs to be done), "deadline": string|null (ISO date YYYY-MM-DD if a date is visible or inferable, else null), "confidence": "high"|"medium"|"low"}`;

app.post('/api/extract-assignment', async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });
    res.json(
      await getJson(
        [
          { role: 'system', content: EXTRACT_SYSTEM },
          { role: 'user', content: imageContent('Extract the assignment and deadline from this screenshot.', imageBase64, mimeType) },
        ],
        { model: VISION_MODEL, json: false, maxTokens: 1400 },
        extractJson
      )
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const BACKWARD_PLAN_SYSTEM = `You help someone with ADHD/executive function challenges plan backward from a deadline for a task, spreading work across multiple days/sessions instead of one overwhelming sitting.

Rules:
- Split into daily sessions between today and the deadline (inclusive), fewer, more meaningful sessions beat too many tiny ones, usually 2-6 sessions total even if there are many days available.
- Never use em dashes in any text you write.
- Each day gets 2-5 small concrete steps (2-20 min each).
- Front-load lighter work early, keep the final day light (review/submit) not cram-heavy.
- If assignment details are provided, mine them for every concrete requirement (word or page count, number of sources or citation style, required sections, formatting, submission format) and work each one explicitly into a step title instead of writing generic steps.
- Respond ONLY with JSON: {"days": [{"date": "YYYY-MM-DD", "label": string (e.g. "Today", "Tomorrow", or a short description), "steps": [{"title": string, "minutes": number}]}]}`;

app.post('/api/backward-plan', async (req, res) => {
  try {
    const { task, deadline, today, energy, context } = req.body;
    if (!task || !deadline || !today) {
      return res.status(400).json({ error: 'task, deadline, and today are required' });
    }
    let userMsg = `Task: "${task}"\nToday's date: ${today}\nDeadline: ${deadline}`;
    if (context) userMsg += `\nAssignment details (from Canvas/Classroom): "${context}"`;
    if (energy && ENERGY_GUIDANCE[energy]) userMsg += `\n${ENERGY_GUIDANCE[energy]}`;
    res.json(
      await getJson([
        { role: 'system', content: BACKWARD_PLAN_SYSTEM },
        { role: 'user', content: userMsg },
      ])
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const CHECKIN_SYSTEM = `You are a warm, brief focus check-in companion for someone with ADHD working through a task list. You are NOT a therapist or motivational speaker, you are a calm co-worker who checks in every so often. Never use em dashes.

You will be given: the overall task, the current step they're supposed to be on, and what they just said when asked "what are you working on right now?".

Behavior:
- If they report working on the current step (or close to it): give one short affirming line (max 15 words). No exclamation-point spam.
- If they report doing something unrelated (drifted/distracted): gently, non-judgmentally redirect back to the current step in one short sentence. Never scold.
- If they say they're stuck or the step is too big: propose ONE smaller sub-step they could do in under 5 minutes.
- If they say they finished the step: congratulate briefly and say to mark it done and move to the next one.
- Always respond ONLY with JSON: {"message": string, "signal": "on_track"|"drifted"|"stuck"|"done"}`;

app.post('/api/checkin', async (req, res) => {
  try {
    const { task, currentStep, userReply } = req.body;
    if (!task || !currentStep || !userReply) {
      return res.status(400).json({ error: 'task, currentStep, and userReply are required' });
    }
    res.json(
      await getJson([
        { role: 'system', content: CHECKIN_SYSTEM },
        {
          role: 'user',
          content: `Overall task: "${task}"\nCurrent step they should be on: "${currentStep}"\nWhat they just said: "${userReply}"`,
        },
      ])
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PANIC_SYSTEM = `The person is overwhelmed by their current task list. Given the remaining steps, pick or invent the SINGLE tiniest, easiest next physical/mental action (under 3 minutes) that would move them forward even slightly. It doesn't have to be one of the listed steps verbatim, simplify further if needed. Never use em dashes.

Respond ONLY with JSON: {"title": string, "minutes": number (1-3)}`;

app.post('/api/panic', async (req, res) => {
  try {
    const { task, remainingSteps } = req.body;
    if (!task || !Array.isArray(remainingSteps) || !remainingSteps.length) {
      return res.status(400).json({ error: 'task and remainingSteps are required' });
    }
    res.json(
      await getJson([
        { role: 'system', content: PANIC_SYSTEM },
        {
          role: 'user',
          content: `Overall task: "${task}"\nRemaining steps: ${remainingSteps.map((s) => `"${s}"`).join(', ')}`,
        },
      ])
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Integrations config / status ---

app.get('/api/config', (req, res) => {
  // Optional server-side defaults (.env). The app also lets users supply their own
  // Google Client ID / Canvas credentials at runtime via in-app setup modals.
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    canvasUrl: process.env.CANVAS_URL || null,
    canvasConfigured: Boolean(process.env.CANVAS_URL && process.env.CANVAS_TOKEN),
  });
});

app.post('/api/canvas/assignments', async (req, res) => {
  const canvasUrl = req.body.canvasUrl || process.env.CANVAS_URL;
  const canvasToken = req.body.canvasToken || process.env.CANVAS_TOKEN;
  if (!canvasUrl || !canvasToken) {
    return res.status(400).json({ error: 'canvasUrl and canvasToken are required' });
  }
  try {
    const coursesRes = await fetch(`https://${canvasUrl}/api/v1/courses?enrollment_state=active&per_page=50`, {
      headers: { Authorization: `Bearer ${canvasToken}` },
    });
    if (!coursesRes.ok) throw new Error(`Canvas courses error ${coursesRes.status}: ${await coursesRes.text()}`);
    const courses = await coursesRes.json();

    const assignments = [];
    for (const course of courses) {
      const aRes = await fetch(
        `https://${canvasUrl}/api/v1/courses/${course.id}/assignments?order_by=due_at&per_page=25`,
        { headers: { Authorization: `Bearer ${canvasToken}` } }
      );
      if (!aRes.ok) continue;
      const courseAssignments = await aRes.json();
      for (const a of courseAssignments) {
        if (!a.due_at) continue;
        assignments.push({
          id: a.id,
          course: course.name,
          name: a.name,
          dueAt: a.due_at,
          url: a.html_url,
          description: stripHtml(a.description),
        });
      }
    }
    assignments.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    res.json({ assignments: assignments.slice(0, 30) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`taskbreaker running on http://localhost:${PORT}`));
}

export default app;
