# LEAI Privacy Policy

*Version v0.3.0 · Last updated August 13, 2026*

Your privacy matters. This page explains, in plain language, what LEAI collects, what it does not collect, who can see it, and what happens to it.

**The short version:** LEAI does not ask for your name, email, student ID, or an institutional login, and it does not link your feedback to a named student account. We do not sell your feedback or build an advertising profile of you. The rest of this document explains the technical codes LEAI uses and what changes if you choose to submit a completion certificate through your course's learning-management system.

## 1. Anonymous by design

When you use the LEAI Feedback Collector, no name, email, student ID, institutional login, or profile information is asked for or stored. Your conversation is tagged with a randomly generated session code (for example, *id_k3m9x2ab*) so the system can group your messages within one conversation. The code is not linked to you as a person. In courses that do not use cross-week continuity (Section 2), closing the tab ends the link between you and that code; in courses that do, sessions started from the same device can be grouped with each other, but still not with you as a named person.

Your instructor cannot use LEAI to connect a feedback conversation to a named student. That is the point — it lets you be honest without worrying about how it might look. The chat page shows an **ANONYMOUS** badge near the top of the screen as a visual reminder.

If your instructor enables completion certificates, you may download a PDF containing a random completion code after LEAI saves at least one response from your session. LEAI privately links that code to the anonymous session and a coarse snapshot of how far the conversation had progressed when the certificate was first issued. Instructors can use LEAI to check whether the code was issued for the selected survey, but LEAI does not show them the linked session, progress snapshot, or responses. If you submit the PDF through Canvas or another course system, that system and your instructor can associate the file with your course identity, but the code does not reveal which LEAI feedback conversation was yours.

## 2. What we store

For each message you send or receive in LEAI, the backend stores:

- The text of the message

- Whether the message came from you or from the AI

- A timestamp

- The randomly generated session code described above

- The survey identifier (which course and which prompt)

- The name of the AI model used to generate the reply

- Your per-session research-consent choice (see Section 6)

- If you request a completion certificate: the certificate code, when it was issued, the survey and anonymous session it belongs to, and a coarse progress snapshot

In courses where the instructor has enabled **cross-week continuity**, the backend additionally stores two technical device signals per session: a randomly generated code kept in your browser's local storage, and a device fingerprint computed from browser characteristics. Their only use is grouping sessions that came from the same device across the course's weekly surveys, so the instructor can see how feedback evolves over the quarter under an arbitrary label such as "S3". They are not linked to your name or any account, are not shared outside the operational chain in Section 5, and are not used for advertising or analytics. In courses without this setting, neither signal is collected.

Those are the records LEAI uses for feedback collection and optional completion verification. We do **not** store advertising identifiers or analytics cookies, and LEAI does not tie these records to your identity as a named person.

## 3. IP addresses and access logs

LEAI's application code does not log or store your IP address as part of any feedback record. However, all web traffic to the LEAI backend reaches it over the public internet, so the underlying cloud platform (currently Heroku, on Amazon Web Services in the United States) and our application server may briefly retain network-level access logs that include IP addresses for operational purposes such as detecting abuse and routing traffic. These short-lived logs are not joined to feedback content and are not used for any analysis of feedback.

## 4. Why we collect it

The whole point of LEAI is to streamline feedback to your instructor *while the course is still running*. End-of-quarter surveys help future students; they do nothing for you. LEAI exists to change that: your instructor reads the aggregated feedback mid-course and uses it to improve your experience in the remaining weeks of the class. If completion certificates are enabled, the certificate record is also used to let your instructor verify that a code was issued for a particular survey. We are not selling your data, advertising to you, or building a profile of you.

## 5. Who can see your data

- **Your course instructor** and any teaching assistants the instructor grants access to (by sharing the course's access password) can read the anonymous feedback submitted to that course's surveys. If completion certificates are enabled, they can also check whether a code was issued for one exact survey. LEAI returns only the code and a valid/not-found result; it does not expose the code-to-session link, progress snapshot, or responses. Anyone the instructor shares the course password with can read everything available to instructors for that course; the instructor is responsible for controlling that scope.

- **The GUII Lab research team** maintains the system and has access to the underlying database as needed to operate the service (fixing bugs, performing backups, and migrating data).

- **The AI provider** described in Section 7 receives the text of your conversation and the system prompt your instructor wrote. LEAI does not add your name, institutional ID, or session code to these requests, but any identifying details you include in your messages are sent as part of the text.

- **No other third parties.** We do not share, sell, or disclose your feedback to advertisers, data brokers, or any party outside the operational chain described above.

## 6. Optional research use

We are actively improving LEAI so that future students at your institution (and others) get a better version of it. **If you check the optional research-consent box on the welcome screen,** you give the GUII Lab permission to analyze the text of your messages in that session for research about how students use AI feedback tools. This consent is recorded server-side as a per-message flag, so any later research analysis is restricted to messages where the flag is true. Published results would only ever report aggregated or de-identified findings.

**If you do not check that box,** your messages are still readable by your instructor for course improvement (that is the operational purpose of the tool), but they will not be used in any GUII Lab research analysis.

This consent is **per session**. Each time you start a new feedback session, the box appears again and you can choose freshly.

## 7. AI processing

LEAI uses the OpenAI API to generate the conversational prompts you see. Your conversation text and the system prompt your instructor wrote are sent to OpenAI for processing so it can return a response. LEAI does not add your name, institutional ID, or session code to these requests. Any personal details you include in your messages are part of the text sent to OpenAI, so please do not include identifying information.

According to OpenAI, data sent through its API is not used to train or improve its models by default, unless the API customer explicitly opts in to share that data. This is OpenAI's stated policy. It does not mean that OpenAI does not receive, process, or retain API data. OpenAI also states that it may retain API content for abuse monitoring and certain API features, subject to its policies and applicable account settings. See OpenAI's [API data controls documentation](https://developers.openai.com/api/docs/guides/your-data). We may switch providers in the future; if we do, we will update this section.

## 8. Data retention

LEAI is a research prototype and does not yet enforce an automated retention schedule. Feedback data is retained on the GUII Lab's backend for the duration of the course and for as long as the lab continues to operate the service. We are working toward a documented retention and deletion schedule and will publish it here once it is in place. In the meantime, instructors and students may request deletion of specific data as described in Section 9.

## 9. Your rights

LEAI cannot look up feedback by your name, email, or student ID because it does not collect those identifiers. A session code or completion-certificate code may let the GUII Lab locate an anonymous technical record, but it does not establish who submitted it. The most reliable way to keep something out of the dataset is not to submit it: you can close the tab at any time and any unsent draft is discarded.

## 10. Security

Data is transmitted over HTTPS and stored in a managed cloud database operated by the GUII Lab on commercial cloud infrastructure (currently Heroku Postgres on Amazon Web Services, US region). LEAI is a research prototype and its security controls are evolving. Course access uses a shared password which is hashed before being stored. We do not currently require multi-factor authentication. Treat LEAI as you would an early-stage academic tool: do not submit anything you would not be willing for your instructor or the GUII Lab to read.

## 11. FERPA and educational records

LEAI is a research and feedback tool operated by the GUII Lab at UC Santa Cruz. It is not part of UCSC's official student record system, and feedback submitted through LEAI is not shared with the UCSC registrar. If you submit a completion certificate through Canvas or another institutional system, that separate course submission may be handled as an education record under your institution's policies.

## 12. Changes to this policy

We may update this policy as the tool evolves. Material changes — anything that affects what is collected, who can see it, or how it is used — will trigger a fresh consent prompt the next time you open a feedback session, so you can review and re-confirm. The version date at the top of this page is the version you are agreeing to today.

## 13. Contact

Questions about this privacy policy, or concerns about how LEAI handles your data, can be directed to the GUII Lab at UC Santa Cruz.
