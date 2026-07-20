# Messages for Kate, CMPM 80K

Kate's `CMPM80K_Studio_Handbook.docx` (2026-07-16) commits students to a weekly LEIA check-in
and to peer review in LEIA. Harvey confirmed she's running the summer async version. Two Google
Docs hold the submission format, built off Magy's 80H.

- Individual: https://docs.google.com/document/d/127LZX31y7W9YcHUOZgXKnwgf8gYhb7-JpYXLNyq_keU/edit
- Group / peer review: https://docs.google.com/document/d/1W6JQwhgXV-zcDjJID6ZQgAF-dFPnCk8dUIglWcF3ZC4/edit

One topic per message so she can reply inline.

---

## 1. The two docs

Hi Kate, thanks for the handbook. Clearest one I've been handed.

I've drafted what you'd receive as the submission, in the same format Magy uses for her summer
80H. Students never type into it. They talk to the bot, and it hands them the filled-in document
to upload.

- Part 1, individual [link]
- Parts 2 and 3, studio + peer review [link]

Two separate conversations. Students do both. Comment inline on anything.

One small thing. The handbook calls the tool LEIA. It's LEAI, Learning Experience AI. Can you fix
that before students see both? The bot goes by LEAI in your class. Magy nicknamed hers Remi, so
say if you'd like a custom name for yours.

---

## 2. Which weeks get which

Your table lists ten weeks. Which get an individual check-in, and which get a studio one?

My guess is individual every week, studio from Week 5 when the capstone starts. But studios form
in Week 1, so tell me if you want to hear from teams earlier than that.

Peer review is mid-quarter and end-of-quarter. Which weeks are those?

---

## 3. Peer review and the multiplier

I read your peer-review line as LEAI collecting the review, and you and the CDs applying the
0.8x to 1.2x multiplier. The tool isn't computing a number. Right?

If so, most of it exists already. Section 2.2 in the group doc walks each teammate by name, in a
private session, one student at a time.

Teammates do get named in the transcript. Magy was fine with that for her graded surveys. Are
you?

And this puts LEAI inside a grade for the first time. It's built for low-stakes feedback.
Students who know it feeds a multiplier may answer differently. Nothing for you to do about it. I
just didn't want to spring it on you in week 6.

---

## 4. The bot will point students to a human

We're adding something for your class. Your line about feeling out of your depth being normal in
the first few weeks is what made it fit 80K.

It works like this.

1. A student says something that signals they're stuck, lost, behind, or struggling.
2. The bot acknowledges it.
3. It adds one warm, low-pressure line inviting them to bring it up with their instructor or TA.
4. It goes back to the question.

It won't troubleshoot, and it won't promise anything on your behalf ("they'll give you an
extension"). The line is a gentle suggestion, never "this is the time to." One mention, then it
drops it. Nobody gets named, students just hear "your instructor or TA".

> **Student:** honestly I'm lost, everyone else has made games before and I haven't
>
> **LEAI:** Mm. No pressure at all, but it might help to bring this up with your instructor or TA
> during their office hours whenever you'd like. What's the part that's hardest to get started
> on?

Here's my problem. The handbook still has `[name, email, hours]` unfilled, and "hours" shows up
nowhere else in it. Do office hours exist for the summer async section? When? If there's no
standing hour, where should I send them instead?

---

## 5. Your Week 1 concepts

The bot refuses to define things. That refusal is what keeps it a check-in instead of a tutor.

For studio vocabulary (dispatch, standup, capstone, runway, not-yet) I want it to point students
at your glossary instead of stonewalling them, since that's what you tell them to do anyway.
Does that work? It'd still refuse on design concepts. Those are yours to teach.

I also need your Week 1 concepts. I have your weekly topics but not the terms inside them. Week
1 is "Play vs. games; founding your studio". What do you actually cover? Weeks 2 through 10 can
wait. Week 1 is what I need to start drafting.

---

## Notes to self (not for Kate)

- Blocking `wk1-cmpm80k-form.md`: Week 1 concepts (Msg 5), office hours (Msg 4).
- Summer async confirmed, so 2.1 should ask about the async standup + sync log, not lab.
- Bot uses the default LEAI tag (blank `Course.bot_display_name`); no custom name this course.
- Referral is engine work: 7th gate in `_TURN_GATES` (`leai-formmode.js:28-36` +
  `leai_formmode.py:103-111`), schema-flagged, toggled from Customizations. Static-prompt rules
  are ignored ~90% of the time (`cmpm80h-production-parity-patch.md:29-33`), so it cannot live
  in the prompt doc.
- Magy's `team_reflection_survey_*.docx` is gone from disk (only orphaned Word lock files in
  ~/Downloads). Ask Harvey for it if we want to show Kate her form.
