'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const leaiProgress = require('../leai-progress.js');

function surveysFixture() {
    return [
        {
            gpt_id: 20,
            mode: 'form',
            week_number: 2,
            survey_label: 'Week 2 Form',
            sessions: {
                'w2-empty': [{ sent_by: 'assistant', content: 'Opening question' }],
                'w2-a': [{ sent_by: 'user', content: 'Week two response' }],
            },
        },
        {
            gpt_id: 10,
            mode: 'form',
            week_number: 1,
            survey_label: 'Week 1 Form',
            sessions: {
                'w1-b': [{ sent_by: 'user-message', content: 'Second response' }],
                'w1-a': [{ sent_by: 'user', content: 'First response' }],
            },
        },
    ];
}

test('response numbering restarts within each week while internal ids stay course-wide', () => {
    const records = leaiProgress.buildResponseRecords(surveysFixture());

    assert.deepEqual(
        records.map((record) => [
            record.sessionId,
            record.internalRid,
            record.weekRid,
            record.courseRid,
        ]),
        [
            ['w1-a', 'R1', 'R1', 'W1-R1'],
            ['w1-b', 'R2', 'R2', 'W1-R2'],
            ['w2-a', 'R3', 'R1', 'W2-R1'],
        ]
    );
});

test('response numbering uses the lexical session order shared by the week view and citation corpus', () => {
    const records = leaiProgress.buildResponseRecords([{
        gpt_id: 10,
        mode: 'form',
        week_number: 1,
        sessions: {
            'z-first-from-backend': [{ sent_by: 'user', content: 'First' }],
            'a-second-from-backend': [{ sent_by: 'user', content: 'Second' }],
        },
    }]);

    assert.deepEqual(
        records.map((record) => [record.sessionId, record.weekRid]),
        [
            ['a-second-from-backend', 'R1'],
            ['z-first-from-backend', 'R2'],
        ]
    );
});

test('response display ids adapt to week, course, and progress contexts', () => {
    const records = leaiProgress.buildResponseRecords(surveysFixture());
    const weekTwo = records.find((record) => record.sessionId === 'w2-a');

    assert.equal(leaiProgress.displayId(weekTwo, 'week', false), 'R1');
    assert.equal(leaiProgress.displayId(weekTwo, 'course', false), 'W2-R1');
    assert.equal(leaiProgress.displayId(weekTwo, 'course', true), 'Form-W2-R1');
});

test('PDF-backed form responses count even without a student-role message', () => {
    const records = leaiProgress.buildResponseRecords([{
        gpt_id: 30,
        mode: 'form',
        week_number: 3,
        sessions: {
            pdf: [{ sent_by: 'assistant', source: 'pdf', content: 'Q: Workload\n\nA: High' }],
        },
    }]);

    assert.equal(records.length, 1);
    assert.equal(records[0].courseRid, 'W3-R1');
});

test('response links encode and validate response detail state in the fragment', () => {
    const record = leaiProgress.buildResponseRecords(surveysFixture())
        .find((entry) => entry.sessionId === 'w2-a');

    assert.equal(
        leaiProgress.buildResponseHash(record),
        '#response=1&mode=form&week=2&session=w2-a'
    );
    assert.deepEqual(
        leaiProgress.parseResponseHash('#response=1&mode=form&week=2&session=w2-a'),
        { mode: 'form', week: 2, sessionId: 'w2-a' }
    );
    assert.equal(
        leaiProgress.parseResponseHash('#response=1&mode=evil&week=x&session=w2-a'),
        null
    );
    assert.equal(
        leaiProgress.parseResponseHash('#response=1&mode=form&week=2'),
        null
    );
});

test('response identifiers stay stable when a rendered subset filters earlier responses', () => {
    const completeRecords = leaiProgress.buildResponseRecords(surveysFixture());
    const bySession = leaiProgress.indexBySessionId(completeRecords);
    const renderedSessionIds = ['w1-b', 'w2-a'];

    assert.deepEqual(
        renderedSessionIds.map((sessionId) => bySession[sessionId].courseRid),
        ['W1-R2', 'W2-R1']
    );
});

test('week-local response numbers are independent for chat, form, and group modes', () => {
    const records = leaiProgress.buildResponseRecords([
        {
            gpt_id: 1,
            mode: 'general',
            week_number: 1,
            sessions: { chat: [{ sent_by: 'user', content: 'Chat response' }] },
        },
        {
            gpt_id: 2,
            mode: 'form',
            week_number: 1,
            sessions: { form: [{ sent_by: 'user', content: 'Form response' }] },
        },
        {
            gpt_id: 3,
            mode: 'group',
            week_number: 1,
            sessions: { group: [{ sent_by: 'user', content: 'Group response' }] },
        },
    ]);

    assert.deepEqual(
        records.map((record) => leaiProgress.displayId(record, 'course', true)),
        ['Chat-W1-R1', 'Form-W1-R1', 'Group-W1-R1']
    );
});

test('response href opens the analyzer with response state in its fragment', () => {
    const record = leaiProgress.buildResponseRecords(surveysFixture())
        .find((entry) => entry.sessionId === 'w2-a');

    assert.equal(
        leaiProgress.buildResponseHref(record),
        'FeedbackAnalyzer.html#response=1&mode=form&week=2&session=w2-a'
    );
});

test('progress tabs remain hidden unless tracking is enabled and relevant data exists', () => {
    const records = [
        { mode: 'form', sessionId: 'form-1', surveyId: 1, identity: { label: 'S1' } },
        { mode: 'group', sessionId: 'group-1', surveyId: 2, identity: { label: 'S1' } },
    ];
    const teamData = {
        2: { teamsBySessionId: { 'group-1': { teamNumber: 1 } } },
    };

    assert.deepEqual(
        leaiProgress.progressVisibility({
            trackingEnabled: false,
            records: records,
            surveyTeamData: teamData,
        }),
        { studentProgress: false, groupProgress: false }
    );
    assert.deepEqual(
        leaiProgress.progressVisibility({
            trackingEnabled: true,
            records: records,
            surveyTeamData: {},
        }),
        { studentProgress: true, groupProgress: false }
    );
    assert.deepEqual(
        leaiProgress.progressVisibility({
            trackingEnabled: true,
            records: records,
            surveyTeamData: teamData,
        }),
        { studentProgress: true, groupProgress: true }
    );
});

test('group progress keeps configurations separate and nests pseudonymous students by week', () => {
    const records = [
        { mode: 'group', week: 1, sessionId: 'a', surveyId: 11, identity: { label: 'S2' }, courseRid: 'W1-R1', modeLabel: 'Group' },
        { mode: 'group', week: 1, sessionId: 'a2', surveyId: 11, identity: { label: 'S2' }, courseRid: 'W1-R2', modeLabel: 'Group' },
        { mode: 'group', week: 1, sessionId: 'b', surveyId: 11, identity: { label: 'S1' }, courseRid: 'W1-R2', modeLabel: 'Group' },
        { mode: 'group', week: 2, sessionId: 'c', surveyId: 12, identity: { label: 'S1' }, courseRid: 'W2-R1', modeLabel: 'Group' },
        { mode: 'group', week: 2, sessionId: 'unlinked', surveyId: 12, identity: null, courseRid: 'W2-R2', modeLabel: 'Group' },
        { mode: 'group', week: 2, sessionId: 'other-config', surveyId: 13, identity: { label: 'S3' }, courseRid: 'W2-R1', modeLabel: 'Group' },
    ];
    const teamData = {
        11: {
            teamsBySessionId: {
                a: { sourceConfigurationId: 7, configurationName: 'Project Teams', teamNumber: 1, teamLabel: 'Team 1', teamSize: 4 },
                a2: { sourceConfigurationId: 7, configurationName: 'Project Teams', teamNumber: 1, teamLabel: 'Team 1', teamSize: 4 },
                b: { sourceConfigurationId: 7, configurationName: 'Project Teams', teamNumber: 1, teamLabel: 'Team 1', teamSize: 4 },
            },
        },
        12: {
            teamsBySessionId: {
                c: { sourceConfigurationId: 7, configurationName: 'Project Teams', teamNumber: 1, teamLabel: 'Team 1', teamSize: 4 },
                unlinked: { sourceConfigurationId: 7, configurationName: 'Project Teams', teamNumber: 1, teamLabel: 'Team 1', teamSize: 4 },
            },
        },
        13: {
            teamsBySessionId: {
                'other-config': { sourceConfigurationId: 8, configurationName: 'Lab Teams', teamNumber: 1, teamLabel: 'Team 1', teamSize: 3 },
            },
        },
    };

    const sections = leaiProgress.buildGroupProgress(records, teamData);

    assert.deepEqual(sections.map((section) => section.key), ['7:1', '8:1']);
    assert.deepEqual(sections[0].students.map((student) => student.label), ['S1', 'S2']);
    assert.deepEqual(Object.keys(sections[0].students[0].byWeek), ['1', '2']);
    assert.deepEqual(sections[0].completeness, {
        1: { responses: 3, trackedStudents: 2, teamSize: 4 },
        2: { responses: 2, trackedStudents: 1, teamSize: 4 },
    });
    assert.deepEqual(sections[0].unlinkedByWeek, { 2: 1 });
    assert.equal(sections[1].configurationName, 'Lab Teams');
});

test('team assignment data is requested only for group surveys', () => {
    assert.equal(leaiProgress.needsTeamData({ mode: 'group' }), true);
    assert.equal(leaiProgress.needsTeamData({ mode: 'form' }), false);
    assert.equal(leaiProgress.needsTeamData({ mode: 'general' }), false);
});

test('only an unmodified primary click uses the session-transfer new-tab path', () => {
    assert.equal(leaiProgress.isPlainPrimaryClick({ button: 0 }), true);
    assert.equal(leaiProgress.isPlainPrimaryClick({ button: 1 }), false);
    assert.equal(leaiProgress.isPlainPrimaryClick({ button: 0, metaKey: true }), false);
    assert.equal(leaiProgress.isPlainPrimaryClick({ button: 0, ctrlKey: true }), false);
    assert.equal(leaiProgress.isPlainPrimaryClick({ button: 0, shiftKey: true }), false);
    assert.equal(leaiProgress.isPlainPrimaryClick({ button: 0, altKey: true }), false);
});

test('progress confidence copy communicates uncertainty without exposing matching mechanics', () => {
    const strong = leaiProgress.confidencePresentation('strong', 'S2');
    const weak = leaiProgress.confidencePresentation('weak', 'S2');
    const visibleCopy = Object.values(leaiProgress.progressConfidenceCopy)
        .concat(Object.values(strong), Object.values(weak))
        .join(' ');

    assert.equal(strong.matchLabel, 'More-confident match');
    assert.equal(strong.rowLabel, 'Higher confidence');
    assert.equal(weak.matchLabel, 'Possible match, less certain');
    assert.equal(weak.rowLabel, 'Mixed confidence');
    assert.match(weak.studentTitle, /Possibly the same anonymous student.*less certain/i);
    assert.doesNotMatch(visibleCopy, /fingerprint|device|browser|storage/i);
});
