import puppeteer from 'puppeteer';

const BASE = 'http://localhost:8181/LEAI';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

// 1. PromptDesigner - step 1 (create mode)
await page.goto(BASE + '/PromptDesigner.html', { waitUntil: 'networkidle0' });
await page.screenshot({ path: '01-course-setup.png', fullPage: false });

// 2. PromptDesigner - locked + survey list
await page.evaluate(() => {
  lockCourse('cm150-sp26', 'Foundations of Computational Media');
});
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => {
  const fakeSurveys = [
    { id: 12, week_number: 3, survey_label: 'Week 3 — Assignment Clarity', name: '' },
    { id: 17, week_number: 6, survey_label: 'Week 6 — Team Dynamics Check-in', name: '' },
    { id: 21, week_number: 9, survey_label: 'Week 9 — Final Project Prep', name: '' },
  ];
  const container = document.getElementById('survey-list-container');
  container.textContent = '';
  const BASE_URL = window.location.origin + window.location.pathname.replace('PromptDesigner.html', 'feedback.html');
  const list = document.createElement('div');
  list.className = 'survey-list';
  fakeSurveys.forEach(s => {
    const link = BASE_URL + '?id=' + s.id;
    const item = document.createElement('div');
    item.className = 'survey-item';
    const title = document.createElement('div');
    title.className = 'survey-item-title';
    title.textContent = s.survey_label;
    const meta = document.createElement('div');
    meta.className = 'survey-item-meta';
    meta.textContent = 'Week ' + s.week_number;
    const linkBox = document.createElement('div');
    linkBox.className = 'link-box';
    const linkSpan = document.createElement('span');
    linkSpan.className = 'link-text';
    linkSpan.textContent = link;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    linkBox.appendChild(linkSpan);
    linkBox.appendChild(copyBtn);
    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(linkBox);
    list.appendChild(item);
  });
  container.appendChild(list);
});
await page.screenshot({ path: '02-survey-list.png', fullPage: false });

// 3. FeedbackCollector
await page.goto(BASE + '/feedback.html?id=17', { waitUntil: 'networkidle0' });
await page.evaluate(() => {
  document.querySelector('.select-wrapper').style.display = 'none';
  document.querySelector('h2').textContent = '💬 Week 6 — Team Dynamics Check-in';
  document.getElementById('sendMessage').disabled = false;
  const msgs = [
    { cls: 'ai-message', text: "Hi! I'm here to hear about your team experience this week. How has collaboration been going so far?" },
    { cls: 'user-message', text: "It's been a bit rough honestly — we don't have a clear owner for the technical side and keep stepping on each other's toes." },
    { cls: 'ai-message', text: "That sounds frustrating. Can you tell me more about what's causing the overlap? Is it about task assignment or communication?" },
    { cls: 'user-message', text: "Mostly task assignment. We split things at the start but it wasn't specific enough and now two of us are doing the same work." },
  ];
  const t = document.getElementById('transcription');
  t.textContent = '';
  msgs.forEach(m => {
    const div = document.createElement('div');
    div.className = 'message ' + m.cls;
    div.textContent = m.text;
    t.appendChild(div);
  });
});
await page.screenshot({ path: '03-feedback-collector.png', fullPage: false });

// 4. Analyzer login
await page.goto(BASE + '/FeedbackAnalyzer.html', { waitUntil: 'networkidle0' });
await page.screenshot({ path: '04-analyzer-login.png', fullPage: false });

// 5. Analyzer overview
await page.evaluate(() => {
  session = { courseId: 'cm150-sp26', courseName: 'Foundations of Computational Media' };
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('app-course-name').textContent = session.courseName;
  document.getElementById('app-course-id').textContent = session.courseId;
  allSurveys = [
    { gpt_id: 12, name: '', week_number: 3, survey_label: 'Week 3 — Assignment Clarity', session_count: 14, sessions: {} },
    { gpt_id: 17, name: '', week_number: 6, survey_label: 'Week 6 — Team Dynamics Check-in', session_count: 11, sessions: {} },
    { gpt_id: 21, name: '', week_number: 9, survey_label: 'Week 9 — Final Project Prep', session_count: 8, sessions: {} },
  ];
  renderOverview(allSurveys);
});
await page.screenshot({ path: '05-analyzer-overview.png', fullPage: false });

// 6. Analyzer survey detail with analysis
await page.evaluate(() => {
  const s = { gpt_id: 17, name: '', week_number: 6, survey_label: 'Week 6 — Team Dynamics Check-in', session_count: 11,
    sessions: { 'id_a1b2': [{sent_by:'user-message',content:'We keep stepping on each other.',created_at:''}] }
  };
  openSurveyDetail(s);
  const fakeAnalysis = {
    themes: [
      { label: 'Task Ownership Ambiguity', count: 8, summary: 'Students frequently described confusion about who is responsible for specific deliverables, leading to duplicated effort.', quotes: ['"We keep stepping on each other — unclear who owns what."', '"Two of us ended up doing the same part of the prototype."'] },
      { label: 'Communication Gaps', count: 6, summary: 'Students noted that async communication is insufficient and team check-ins are too infrequent to catch misalignments.', quotes: ['"We only really talk synchronously once a week and that\'s not enough."'] },
      { label: 'Pacing & Scope Creep', count: 4, summary: 'Several students expressed concern that the project scope has expanded beyond what was originally scoped.', quotes: ['"The requirements keep shifting and it\'s hard to know what done looks like."'] },
    ],
    friction: [
      { description: 'At least 3 teams have unresolved role conflicts slowing down production work.', urgency: 'high' },
      { description: 'Students are uncertain about grading criteria for the mid-project review next week.', urgency: 'high' },
      { description: 'Async communication tools are being used inconsistently across teams.', urgency: 'medium' },
    ]
  };
  renderAnalysis(document.getElementById('survey-analysis-output'), fakeAnalysis);
  document.getElementById('analyze-survey-btn').textContent = 'Re-analyze';
});
await page.screenshot({ path: '06-analyzer-detail-themes.png', fullPage: false });
await page.evaluate(() => window.scrollBy(0, 400));
await page.screenshot({ path: '07-analyzer-detail-friction.png', fullPage: false });

await browser.close();
console.log('done');
