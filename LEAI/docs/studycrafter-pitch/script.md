# LEAI Pitch — Spoken Script

Read this aloud. Square brackets are stage cues, not words to say.

Casual, oral tone. About 5 minutes.

---

## Slide 1 — What is LEAI

[click]

Hi everyone, I want to show you a tool from our lab. It's called LEAI — Learning Experience AI. [pause]

End-of-term course evals come too late to actually help the students who took the class. Mid-semester Likert surveys are fast to fill out, but pretty shallow. And open-ended written feedback is much richer, but at forty students a week, few students put effort in responding, and even if they did, no one has time to read it all and turn it into something actionable.

LEAI is our attempt at the middle path. The student spends about five minutes in a short conversational chat with our AI, which is a format they are super familiar with nowadays, where it can ask follow-up questions like a TA would. The instructor gets back a summary they can skim in two minutes, with every claim traceable back to the actual student who said it. So you get the depth of open-ended feedback without the reading workload.

You can think of it as a sibling tool to StudyHelper. StudyHelper helps students learn. LEAI listens to how it went.

It has three parts. The instructor uses Prompt Designer to set up a survey. The student opens Feedback Collector and has a short chat with the AI. Then the instructor goes to Feedback Analyzer to see what came out. [pause]

I'll walk through each part now

---

## Slide 2 — Instructor sets up a survey

[click]

OK so this is the instructor side — Prompt Designer. [pause]

On the right you can see the top of the page. There are three mode tabs up there — General Course Feedback, In-Group Feedback, and Structured Reflection. Below that there are template tabs — Weekly, Midterm, Project, Exit Ticket — so you don't start from scratch. And on the right side you can see the list of surveys I already made — week 1, week 2, week 3. [pause]

On the left here, this is the bottom part of the same page — just the settings. You pick the anonymity mode, like anonymous or with a code. And you set when the survey opens and when it expires. That's it. [pause]

So the whole setup — pick a template, write the bot's voice, pick the mode, share the link. Takes a few minutes, not hours. One per week is pretty common. [pause]

I'll show you Structured Reflection next, then the regular chat.

---

## Slide 3 — Structured Reflection

[click]

So this is the Structured Reflection mode. [pause]

On the left, this is what the instructor sees. They just pick a schema from the dropdown, which will be customizable as well in the near future so instructors can easily tune them — here I picked the HCI 271 Weekly Reflection Journal, and you can see it has four sections, like Key Concepts, Methods in Practice, and so on. The instructor can also write the questions, sections, or whatever structures they prefer, and LEAI will follow them one by one with the ability to followup students for more granular responses. [pause]

On the right, this is what the student sees. Notice it still looks like a normal chat — they don't see the schema. But up at the top left it says "Area 2 of 4 — Methods in Practice." So the AI is walking them through every section in order. They will finish until every section is covered. [pause]

The reason this exists — sometimes you actually need every section answered. For example a graded reflection where every part of the rubric matters. So the structure is in the engine, not on the screen. [pause]

OK, now let me show you the regular default chat. which is more of a unstructured way where it does not require instructors to have specific questions in mind but still capable of collecting directional feedbacks within specific context

---

## Slide 4 — Student experience (default mode)

[click]

This is what the student sees in the normal mode. [pause]

On the left is the very first screen — "Before you begin." It's a quick consent. They check the Terms of Use box, and there's an optional checkbox to let our lab use the data for research. No login, no app, no account — they just open a link.[pause]

On the right is the chat itself. The AI is asking a follow-up question, you can see the three little dots — that's LEAI thinking. And down at the bottom right, you can see the microphone button is on, in red — so the student can just speak instead of typing. That's actually super useful for students who are tired or on their phone. [pause]

So four things matter here — the chat is conversational, so the AI follows up. The student is anonymous, you can see the green "Anonymous" badge at the top. If it's a team survey they can pick their team. And they can talk instead of type. [pause]

This is the default mode. Open, free-form, good for general feedback.

---

## Slide 5 — From conversations to insights

[click]

OK so now we're on the instructor side again — Feedback Analyzer. [pause]

On the left, this is the top of the analyzer. You can see the basic numbers — 37 responses, 95% participation, average 140 words per student. And below that is the Traditional Analysis — that's the statistical view, the distinctive words from the responses. So things like "dr john," "prediction vs," "observational unit" — these are the words that stand out in this class. This part uses statistics, not AI. [pause]

On the ride side, is the AI Takeaway view — same Feedback Analyzer, just scrolled down. [pause]

you can see the AI summary, with citations like 28, 29, 33, 34, 35 — those numbers are hoverrable. And on the right, I hoverred one of them, R3 from week 3, and it pops up the actual student response — you can see the verified badge, and the full thing the student wrote. So I'm not just trusting the AI summary, I can hover and check the source right away. [pause]

You can also see I have the "Show Prompt" toggled on at the bottom — so you can see exactly what system prompt and user prompt the AI is using. We thought that's important for trust — you should be able to see what's under the hood. [pause]  

And right below there, which is not shown in the screen, is a button to continue the conversation into a AI chat with access to the response data.

The point is — free-form chats are rich, but messy. Forty long conversations are hard to read. and for even larger classes, this could be a disaster for the instructors or TAs. So we give you a few different ways to look at it.

---

## Slide 6 — From conversations to insights (AI Takeaway)

[click]  
This Feedback Chat. During one of my interviews with the instructors, they would really like a direct way to talk through the data and learn about the students' feedback efficiently without lossing any transparentcy. that conversation inspired this feedback chat feature. So if you want to ask a question about the data, you can just chat with it. Here I asked "What are students struggling with this week?" — and you can see the AI answered, and it cited specific responses with those little numbered badges, like 1, 2, 3, 4, 5, 6. So you can click and see exactly which student said what. [pause] and also similar to the ai take away, you can opened the SYSTEM PROMPT button below to check the system prompt, you can even customize it to suit your needs, in the future we will also allow you to select different models or maybe even bring your own models if instructors wish to have that.

So that's basically LEAI. [pause]

The instructor guide is in the repo if you want to look more. Thank you!

---

