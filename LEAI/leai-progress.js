(function (root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.leaiProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MODE_LABELS = {
        general: 'Chat',
        form: 'Form',
        group: 'Group',
    };

    const PROGRESS_CONFIDENCE_COPY = Object.freeze({
        studentInfo: 'Rows are anonymous estimates of the same student; names and accounts are never used. A solid entry is a more-confident match. A dotted entry is a possible match and is less certain. A student may appear in more than one row when the available evidence is insufficient. Sessions from before tracking was enabled cannot be attributed and are listed under Unlinked sessions.',
        groupInfo: 'Each section follows one group across weekly in-group surveys. Students are shown only by anonymous labels such as S1 and S2, never by names. Groups from different team configurations stay separate even when they share the same display name.',
        studentLegend: 'Each row is an anonymous estimate of the same student; no names are collected. A solid entry is a more-confident match. A dotted entry is a possible match and is less certain. Click an entry to open that conversation.',
        anonymousEstimateSuffix: 'Anonymous estimate, never a name.',
        anonymousGroupLabel: 'Students are anonymous labels, never names',
    });

    function confidencePresentation(link, studentLabel) {
        const isLessCertain = link === 'weak';
        const label = studentLabel || 'this row';
        return {
            matchLabel: isLessCertain
                ? 'Possible match, less certain'
                : 'More-confident match',
            rowLabel: isLessCertain
                ? 'Mixed confidence'
                : 'Higher confidence',
            studentTitle: isLessCertain
                ? 'Possibly the same anonymous student as the other ' + label +
                    ' responses, but this match is less certain.'
                : 'More-confident match to the other ' + label + ' responses.',
        };
    }

    function stableSurveyId(survey) {
        if (survey.id != null) return String(survey.id);
        if (survey.gpt_id != null) return String(survey.gpt_id);
        if (survey.public_id != null) return String(survey.public_id);
        return '';
    }

    function isResponseBearing(messages) {
        return (messages || []).some(function (message) {
            const role = message && message.sent_by;
            return role === 'user' || role === 'user-message' ||
                (message && message.source === 'pdf');
        });
    }

    function buildResponseRecords(surveys) {
        const orderedSurveys = (surveys || []).slice().sort(function (a, b) {
            const weekA = Number(a && a.week_number) || 0;
            const weekB = Number(b && b.week_number) || 0;
            if (weekA !== weekB) return weekA - weekB;
            return stableSurveyId(a || {}).localeCompare(stableSurveyId(b || {}), undefined, {
                numeric: true,
            });
        });
        const weekCounters = {};
        const records = [];

        orderedSurveys.forEach(function (survey) {
            const week = Number(survey.week_number) || 0;
            const mode = MODE_LABELS[survey.mode] ? survey.mode : 'general';
            const weekCounterKey = mode + ':' + week;
            const sessions = survey.sessions || {};
            Object.keys(sessions).sort().forEach(function (sessionId) {
                const messages = sessions[sessionId] || [];
                if (!isResponseBearing(messages)) return;
                weekCounters[weekCounterKey] = (weekCounters[weekCounterKey] || 0) + 1;
                const weekRid = 'R' + weekCounters[weekCounterKey];
                records.push({
                    internalRid: 'R' + (records.length + 1),
                    weekRid: weekRid,
                    courseRid: 'W' + week + '-' + weekRid,
                    modeLabel: MODE_LABELS[mode],
                    mode: mode,
                    week: week,
                    sessionId: sessionId,
                    surveyId: survey.id != null ? survey.id : survey.gpt_id,
                    surveyLabel: survey.survey_label || survey.name || ('Week ' + week),
                    messages: messages,
                    identity: (survey.identity && survey.identity[sessionId]) || null,
                });
            });
        });

        return records;
    }

    function displayId(record, scopeKind, qualified) {
        if (!record) return '';
        const base = scopeKind === 'week' ? record.weekRid : record.courseRid;
        return qualified ? record.modeLabel + '-' + record.courseRid : base;
    }

    function buildResponseHash(record) {
        if (!record) return '';
        const params = new URLSearchParams();
        params.set('response', '1');
        params.set('mode', record.mode);
        params.set('week', String(record.week));
        params.set('session', record.sessionId);
        return '#' + params.toString();
    }

    function buildResponseHref(record, pageName) {
        return (pageName || 'FeedbackAnalyzer.html') + buildResponseHash(record);
    }

    function parseResponseHash(hash) {
        const source = String(hash || '').replace(/^#/, '');
        const params = new URLSearchParams(source);
        const mode = params.get('mode');
        const weekText = params.get('week');
        const sessionId = params.get('session');
        const week = Number(weekText);
        if (params.get('response') !== '1' || !MODE_LABELS[mode] ||
            !Number.isInteger(week) || week < 1 || !sessionId) {
            return null;
        }
        return { mode: mode, week: week, sessionId: sessionId };
    }

    function indexBySessionId(records) {
        const index = {};
        (records || []).forEach(function (record) {
            index[record.sessionId] = record;
        });
        return index;
    }

    function progressVisibility(options) {
        const settings = options || {};
        if (!settings.trackingEnabled) {
            return { studentProgress: false, groupProgress: false };
        }
        const records = settings.records || [];
        const surveyTeamData = settings.surveyTeamData || {};
        const studentProgress = records.some(function (record) {
            return !!(record && record.identity && record.identity.label);
        });
        const groupProgress = records.some(function (record) {
            if (!record || record.mode !== 'group' || !record.identity || !record.identity.label) {
                return false;
            }
            const surveyData = surveyTeamData[record.surveyId];
            return !!(surveyData && surveyData.teamsBySessionId &&
                surveyData.teamsBySessionId[record.sessionId]);
        });
        return { studentProgress: studentProgress, groupProgress: groupProgress };
    }

    function numericLabelOrder(a, b) {
        const numberA = Number(String(a || '').replace(/\D+/g, ''));
        const numberB = Number(String(b || '').replace(/\D+/g, ''));
        if (numberA !== numberB) return numberA - numberB;
        return String(a || '').localeCompare(String(b || ''));
    }

    function buildGroupProgress(records, surveyTeamData) {
        const sectionMap = {};
        const teamData = surveyTeamData || {};

        (records || []).forEach(function (record) {
            if (!record || record.mode !== 'group') return;
            const surveyData = teamData[record.surveyId];
            const team = surveyData && surveyData.teamsBySessionId &&
                surveyData.teamsBySessionId[record.sessionId];
            if (!team) return;
            const key = String(team.sourceConfigurationId) + ':' + String(team.teamNumber);
            const section = sectionMap[key] || (sectionMap[key] = {
                key: key,
                sourceConfigurationId: team.sourceConfigurationId,
                configurationName: team.configurationName || 'Team configuration',
                teamNumber: team.teamNumber,
                teamLabel: team.teamLabel || ('Team ' + team.teamNumber),
                weeks: [],
                completeness: {},
                unlinkedByWeek: {},
                studentMap: {},
            });
            if (section.weeks.indexOf(record.week) === -1) section.weeks.push(record.week);
            const completeness = section.completeness[record.week] ||
                (section.completeness[record.week] = {
                    responses: 0,
                    trackedStudentMap: {},
                    teamSize: Number(team.teamSize) || 0,
                });
            completeness.responses++;
            if (!completeness.teamSize && team.teamSize) completeness.teamSize = Number(team.teamSize);

            const studentLabel = record.identity && record.identity.label;
            if (!studentLabel) {
                section.unlinkedByWeek[record.week] =
                    (section.unlinkedByWeek[record.week] || 0) + 1;
                return;
            }
            completeness.trackedStudentMap[studentLabel] = true;
            const student = section.studentMap[studentLabel] ||
                (section.studentMap[studentLabel] = { label: studentLabel, byWeek: {} });
            (student.byWeek[record.week] || (student.byWeek[record.week] = [])).push(record);
        });

        return Object.keys(sectionMap).map(function (key) {
            const section = sectionMap[key];
            section.weeks.sort(function (a, b) { return a - b; });
            Object.keys(section.completeness).forEach(function (week) {
                const completeness = section.completeness[week];
                completeness.trackedStudents = Object.keys(completeness.trackedStudentMap).length;
                delete completeness.trackedStudentMap;
            });
            section.students = Object.keys(section.studentMap)
                .sort(numericLabelOrder)
                .map(function (label) { return section.studentMap[label]; });
            delete section.studentMap;
            return section;
        }).sort(function (a, b) {
            const configOrder = numericLabelOrder(a.sourceConfigurationId, b.sourceConfigurationId);
            return configOrder || Number(a.teamNumber) - Number(b.teamNumber);
        });
    }

    function needsTeamData(survey) {
        return !!(survey && survey.mode === 'group');
    }

    function isPlainPrimaryClick(event) {
        const click = event || {};
        return (click.button == null || click.button === 0) &&
            !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey;
    }

    return {
        buildResponseRecords: buildResponseRecords,
        displayId: displayId,
        buildResponseHash: buildResponseHash,
        buildResponseHref: buildResponseHref,
        parseResponseHash: parseResponseHash,
        indexBySessionId: indexBySessionId,
        progressVisibility: progressVisibility,
        buildGroupProgress: buildGroupProgress,
        needsTeamData: needsTeamData,
        isPlainPrimaryClick: isPlainPrimaryClick,
        confidencePresentation: confidencePresentation,
        progressConfidenceCopy: PROGRESS_CONFIDENCE_COPY,
    };
});
