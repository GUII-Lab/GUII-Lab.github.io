# Legacy Ulia hosted handoff

## Verified local candidate

Original static pages remain the frontend. Both authored fixtures use the existing real `run_orchestration` / `preview_proposal` through new legacy persistence endpoints. Canonical API, models, and React frontend are not substituted into the old course.

Target supplied by owner and verified in production: course 133, `cmpm80h-wi27`, `CMPM 80H — Human Centered AI (Winter 2027)`, Mimi Rapoport. Scoped release and installation are complete. The existing Week 0 survey and answers remain intact; two Ulia surveys were added.

The temporary local reports, screenshots and test records were removed during wrap-up. A concise durable verification and cleanup receipt remains in `.context/ulia-execution-ledger.md`.

## Completed hosted steps

1. Production basis and exact course were verified; existing survey 277 remained unchanged.
2. The user approved the scoped release. Heroku `guiidata` v82 deployed the backend adapter; v83 enabled the exact course allowlist. GitHub Pages published the eight approved frontend files at commit `15dd98fa04f3321be311d1600a1e0b138306c517`. The backend's unrelated 19 local commits were excluded.
3. Migration `0045_legacy_orchestration` was applied. The idempotent installer added survey 310 (`K4Nd9vJOEGGv`, conversational) and 311 (`A6KreGhTnRlg`, Likert); Week 0 survey 277 remains. Re-running the installer read back the same pair.
4. The management command's default read-only preview was run in the hosted environment:

   ```sh
   python manage.py install_legacy_ulia_reflections cmpm80h-wi27
   ```

   The command requires an existing exact legacy course. It refuses conflicting schema bodies or ambiguous duplicate surveys. It does not replace an existing survey.

5. The adapter configuration is scoped to the approved course:

   ```text
   LEAI_LEGACY_ORCHESTRATION_ENABLED=1
   LEAI_LEGACY_ORCHESTRATION_COURSES=cmpm80h-wi27
   ```

   Both default to disabled/empty. The existing canonical `LEAI_ORCHESTRATION_ENABLED` still remains local/QA-only. The adapter checks the actual server-owned survey course at start, turn, locked commit, and finalization; a submitted course ID cannot enable it.

6. Only the confirmed target installation was applied:

   ```sh
   python manage.py install_legacy_ulia_reflections cmpm80h-wi27 --apply
   ```

   Read back both distinct `FeedbackGPT.public_id` values, exact `FormSchema.body.protocol`, engine marker, course association, and count. Expect one conversational survey and one Likert survey. Re-running the installer must report the existing pair.
7. The two deployed links were checked. After the user explicitly requested post-release dialogue testing, one synthetic dialogue per formal survey passed 20 scoped criteria. The exact test sessions and associated messages, receipts, and certificates were deleted and independently verified absent. No extra survey was created.

## Deferred and limits

Physical microphone/touch input and native Word layout were not exercised. One explicit browser-storage recovery limitation notice remains deferred; the current memory/URL session ID survives denied storage. This is a review Minor item, not a claim that all plan requirements or hosted binding are complete.

Linear ownership is owner-confirmed as LEAI Instructor UI Modernization. Existing HAR-20 / HAR-126 target React/canonical QA and must not be marked Done for this legacy-only work. No Linear writes were authorized or made.
