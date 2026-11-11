(function (root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else if (root) {
        root.leaiCompletion = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const CODE_SYMBOL_COUNT = 16;
    const CODE_GROUP_SIZE = 4;
    const VALID_MODES = {
        general: true,
        group: true,
        form: true,
    };
    const STUDENT_MESSAGE_ROLES = {
        user: true,
        'user-message': true,
        student: true,
    };
    const ASSISTANT_MESSAGE_ROLES = {
        assistant: true,
        ai: true,
    };

    function firstDefined(source, keys) {
        for (let index = 0; index < keys.length; index++) {
            const value = source[keys[index]];
            if (value !== undefined) return value;
        }
        return undefined;
    }

    function isBoolean(value) {
        return typeof value === 'boolean';
    }

    function isTrue(value) {
        return value === true;
    }

    function boundedText(value, maximum) {
        if (typeof value !== 'string') return null;
        const text = value.trim();
        if (!text) return null;
        return text.slice(0, maximum);
    }

    function clampInteger(value, minimum, maximum) {
        if (!Number.isInteger(value)) return null;
        let result = value;
        if (minimum != null && result < minimum) result = minimum;
        if (maximum != null && result > maximum) result = maximum;
        return result;
    }

    function nonNegativeInteger(value) {
        if (!Number.isInteger(value)) return null;
        return value < 0 ? 0 : value;
    }

    function normalizeMode(value) {
        return VALID_MODES[value] ? value : 'general';
    }

    function normalizePersistState(value) {
        const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
        if (text === 'pending' || text === 'failed' || text === 'succeeded') {
            return text;
        }
        return 'idle';
    }

    function toIsoDateTime(value) {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString();
    }

    function normalizeCodeCandidate(value) {
        const text = String(value == null ? '' : value).trim().toUpperCase();
        if (!text) return '';
        const compact = text.replace(/[\s-]+/g, '');
        if (compact.length !== CODE_SYMBOL_COUNT) return text;
        for (let index = 0; index < compact.length; index++) {
            if (CODE_ALPHABET.indexOf(compact[index]) === -1) return text;
        }
        const groups = [];
        for (let index = 0; index < CODE_SYMBOL_COUNT; index += CODE_GROUP_SIZE) {
            groups.push(compact.slice(index, index + CODE_GROUP_SIZE));
        }
        return groups.join('-');
    }

    /**
     * Parse multiline/comma-delimited certificate codes without dropping duplicates.
     */
    function normalizeCodes(raw) {
        return String(raw == null ? '' : raw)
            .split(/[\n,]+/)
            .map(normalizeCodeCandidate)
            .filter(function (value) { return !!value; });
    }

    /**
     * Normalize the course-wide download flags from a public bootstrap payload.
     */
    function courseDownloadSettings(source) {
        const settings = source || {};
        return {
            completion_certificate_enabled: isTrue(firstDefined(
                settings,
                ['completion_certificate_enabled', 'completionCertificateEnabled']
            )),
            parsed_document_download_enabled: isTrue(firstDefined(
                settings,
                ['parsed_document_download_enabled', 'parsedDocumentDownloadEnabled']
            )),
        };
    }

    function normalizeRestoredMessageRole(value) {
        const role = String(value == null ? '' : value).trim().toLowerCase();
        if (STUDENT_MESSAGE_ROLES[role]) return 'user';
        if (ASSISTANT_MESSAGE_ROLES[role]) return 'assistant';
        return 'assistant';
    }

    /**
     * Count persisted student-message rows from a restored backend transcript.
     */
    function countPersistedStudentMessages(messages) {
        return (Array.isArray(messages) ? messages : []).reduce(function (count, message) {
            const source = message || {};
            const rawRole = firstDefined(source, ['sent_by', 'sentBy', 'role']);
            return normalizeRestoredMessageRole(rawRole) === 'user' ? count + 1 : count;
        }, 0);
    }

    function buildCompletionMarkerKey(options) {
        const settings = options || {};
        const surveyValue = firstDefined(settings, ['publicId', 'public_id', 'surveyId', 'survey_id']);
        const sessionValue = firstDefined(settings, ['sessionId', 'session_id']);
        const surveyKey = String(surveyValue == null ? '' : surveyValue).trim();
        const sessionKey = String(sessionValue == null ? '' : sessionValue).trim();
        if (!surveyKey || !sessionKey) return null;
        return 'leai_completion_ready:' + surveyKey + ':' + sessionKey;
    }

    /**
     * Build the shared general-survey create/import payload for PromptDesigner.
     */
    function buildPromptDesignerSurveyPayload(source) {
        const settings = source || {};
        const courseId = String(firstDefined(settings, ['courseId', 'course_id']) || '').trim();
        const surveyLabel = String(firstDefined(settings, ['surveyLabel', 'survey_label']) || '').trim();
        const weekRaw = firstDefined(settings, ['weekNumber', 'week_number']);
        const weekNumber = weekRaw === '' || weekRaw == null ? null : parseInt(weekRaw, 10);

        return {
            course_id: courseId,
            name: courseId + ' — ' + surveyLabel,
            week_number: Number.isNaN(weekNumber) ? null : weekNumber,
            survey_label: surveyLabel,
            instructions: String(firstDefined(settings, ['instructions']) || ''),
            instructor_name: String(firstDefined(settings, ['instructorName', 'instructor_name']) || ''),
            opens_at: toIsoDateTime(firstDefined(settings, ['opensAt', 'opens_at'])),
            expires_at: toIsoDateTime(firstDefined(settings, ['expiresAt', 'expires_at'])),
            anonymity_mode: String(firstDefined(settings, ['anonymityMode', 'anonymity_mode']) || 'anonymous'),
        };
    }

    /**
     * Derive the shared footer/download state for general, group, and form modes.
     */
    function downloadState(options) {
        const settings = options || {};
        const mode = normalizeMode(settings.mode);
        const certificateSetting = isTrue(firstDefined(
            settings,
            ['certificateSetting', 'certificate_setting']
        ));
        const documentSetting = isTrue(firstDefined(
            settings,
            ['documentSetting', 'document_setting']
        ));
        const hasPersistedStudentMessage = isTrue(firstDefined(
            settings,
            ['hasPersistedStudentMessage', 'has_persisted_student_message']
        ));
        const complete = isTrue(settings.complete);
        const showCertificate = certificateSetting;
        const showDocument = documentSetting && mode !== 'general';
        const showStrip = showCertificate || showDocument;

        return {
            showStrip: showStrip,
            showCertificate: showCertificate,
            certificateEnabled: showCertificate && hasPersistedStudentMessage,
            showDocument: showDocument,
            documentReady: showDocument && complete,
            presentation: showStrip && complete ? 'ready' : 'normal',
        };
    }

    /**
     * Derive the student-facing footer state, including certificate unlock flow.
     */
    function studentFooterState(options) {
        const settings = options || {};
        const base = downloadState(settings);
        const persistedCountValue = firstDefined(
            settings,
            ['persistedStudentMessageCount', 'persisted_student_message_count']
        );
        const normalizedPersistedCount = nonNegativeInteger(persistedCountValue);
        const hasPersistedFromCount = normalizedPersistedCount != null
            ? normalizedPersistedCount > 0
            : null;
        const hasPersistedStudentMessage = hasPersistedFromCount != null
            ? hasPersistedFromCount
            : isTrue(firstDefined(settings, ['hasPersistedStudentMessage', 'has_persisted_student_message']));
        const persistedStudentMessageCount = normalizedPersistedCount != null
            ? normalizedPersistedCount
            : (hasPersistedStudentMessage ? 1 : 0);
        const firstStudentPersistState = normalizePersistState(firstDefined(
            settings,
            ['firstStudentPersistState', 'first_student_persist_state']
        ));

        let certificateStatus = 'hidden';
        let certificateLabel = '';
        if (base.showCertificate) {
            certificateLabel = hasPersistedStudentMessage
                ? 'Download completion certificate (PDF)'
                : 'Respond once to unlock your certificate';
            if (hasPersistedStudentMessage) {
                certificateStatus = 'ready';
            } else if (firstStudentPersistState === 'pending') {
                certificateStatus = 'pending';
            } else if (firstStudentPersistState === 'failed') {
                certificateStatus = 'failed';
            } else {
                certificateStatus = 'locked';
            }
        }

        let documentStatus = 'hidden';
        let documentLabel = '';
        let documentEnabled = false;
        if (base.showDocument) {
            documentStatus = base.documentReady ? 'ready' : 'draft';
            documentLabel = base.documentReady
                ? 'Download my reflection (Word / .docx)'
                : 'Save draft (.docx) ↓';
            documentEnabled = true;
        }

        return {
            showStrip: base.showStrip,
            showCertificate: base.showCertificate,
            certificateEnabled: base.showCertificate && hasPersistedStudentMessage,
            showDocument: base.showDocument,
            documentReady: base.documentReady,
            presentation: base.presentation,
            hasPersistedStudentMessage: hasPersistedStudentMessage,
            persistedStudentMessageCount: persistedStudentMessageCount,
            firstStudentPersistState: firstStudentPersistState,
            certificate: {
                visible: base.showCertificate,
                enabled: base.showCertificate && hasPersistedStudentMessage,
                status: certificateStatus,
                label: certificateLabel,
            },
            document: {
                visible: base.showDocument,
                enabled: documentEnabled,
                status: documentStatus,
                label: documentLabel,
            },
        };
    }

    /**
     * Build the bounded progress snapshot that is safe to send for certificate issuance.
     */
    function buildProgressSnapshot(options) {
        const source = options || {};
        const mode = normalizeMode(firstDefined(source, ['mode']));
        const studentMessageCount = clampInteger(
            firstDefined(source, ['student_message_count', 'studentMessageCount']),
            0,
            null
        );
        const snapshot = {
            version: 1,
            mode: mode,
            student_message_count: studentMessageCount == null ? 0 : studentMessageCount,
            complete: isBoolean(source.complete) ? source.complete : false,
        };

        if (mode !== 'form') return snapshot;

        const schemaId = boundedText(firstDefined(source, ['schema_id', 'schemaId']), 100);
        if (schemaId) snapshot.schema_id = schemaId;

        const areaIndex = clampInteger(
            firstDefined(source, ['area_index', 'areaIndex', 'current_area_index']),
            1,
            500
        );
        if (areaIndex != null) snapshot.area_index = areaIndex;

        const areaId = boundedText(firstDefined(source, ['area_id', 'areaId']), 100);
        if (areaId) snapshot.area_id = areaId;

        const areaTitle = boundedText(firstDefined(source, ['area_title', 'areaTitle']), 200);
        if (areaTitle) snapshot.area_title = areaTitle;

        const engineTurn = clampInteger(
            firstDefined(source, ['engine_turn', 'engineTurn', 'turn']),
            0,
            10000
        );
        if (engineTurn != null) snapshot.engine_turn = engineTurn;

        const lastDirectiveKind = boundedText(
            firstDefined(source, ['last_directive_kind', 'lastDirectiveKind']),
            100
        );
        if (lastDirectiveKind) snapshot.last_directive_kind = lastDirectiveKind;

        return snapshot;
    }

    /**
     * Return exact-survey verification candidates for the selected week, preserving duplicate order.
     */
    function verificationCandidates(surveys, weekNumber) {
        const targetWeek = Number(weekNumber);
        return (surveys || []).filter(function (survey) {
            return Number(survey && firstDefined(survey, ['week_number', 'weekNumber'])) === targetWeek;
        });
    }

    /**
     * Resolve the exact survey to verify for the current week selection.
     */
    function verificationTarget(candidates, selectedId) {
        const surveys = Array.isArray(candidates) ? candidates : [];
        if (!surveys.length) return null;
        if (surveys.length === 1) return surveys[0];

        const targetId = String(selectedId == null ? '' : selectedId).trim();
        if (!targetId) return null;

        for (let index = 0; index < surveys.length; index++) {
            const survey = surveys[index];
            const gptId = String(firstDefined(survey || {}, ['gpt_id', 'gptId']) || '').trim();
            const surveyId = String(firstDefined(survey || {}, ['id']) || '').trim();
            if (targetId === gptId || targetId === surveyId) return survey;
        }
        return null;
    }

    /**
     * Keep the exact-survey picker usable while blocking code submission until a target exists.
     */
    function verificationControls(candidates, selectedId, pending) {
        const surveys = Array.isArray(candidates) ? candidates : [];
        const requestPending = pending === true;
        const target = verificationTarget(surveys, selectedId);
        return {
            surveyDisabled: requestPending || surveys.length <= 1,
            inputDisabled: requestPending || !target,
            submitDisabled: requestPending || !target,
        };
    }

    /**
     * Normalize a verification submission batch and enforce a deterministic maximum.
     */
    function verificationBatch(raw, max) {
        const limit = Number.isInteger(max) && max > 0 ? max : 100;
        const codes = normalizeCodes(raw);
        if (!codes.length) {
            return {
                codes: [],
                error: 'Enter at least one code to verify.',
            };
        }
        if (codes.length > limit) {
            return {
                codes: [],
                error: 'Enter ' + limit + ' codes or fewer.',
            };
        }
        return {
            codes: codes,
            error: '',
        };
    }

    /**
     * Summarize verification outcomes for display in the analyzer UI.
     */
    function summarizeVerification(results) {
        return (results || []).reduce(function (summary, result) {
            if (result && result.status === 'valid') summary.valid++;
            if (result && result.status === 'not_found') summary.notFound++;
            summary.total++;
            return summary;
        }, {
            valid: 0,
            notFound: 0,
            total: 0,
        });
    }

    function decode5987Value(value) {
        const parts = String(value).split("''");
        const encoded = parts.length > 1 ? parts.slice(1).join("''") : parts[0];
        try {
            return decodeURIComponent(encoded);
        } catch (_error) {
            return '';
        }
    }

    function sanitizeFilename(value) {
        const text = String(value == null ? '' : value);
        if (!text) return '';
        if (/[\u0000-\u001f\u007f]/.test(text)) return '';
        if (/[\\/]/.test(text)) return '';
        if (/(^|[.])\.\.?([.]|$)/.test(text)) return '';
        const trimmed = text.trim();
        if (!trimmed) return '';
        return trimmed;
    }

    /**
     * Parse a safe PDF filename from Content-Disposition, falling back on suspicious values.
     */
    function filenameFromDisposition(header, fallback) {
        const fallbackName = sanitizeFilename(fallback) || 'completion-certificate.pdf';
        const disposition = String(header == null ? '' : header);
        const encodedMatch = disposition.match(/filename\*\s*=\s*([^;]+)/i);
        if (encodedMatch) {
            const encodedName = sanitizeFilename(
                decode5987Value(encodedMatch[1].trim().replace(/^"(.*)"$/, '$1'))
            );
            if (encodedName) return encodedName;
        }

        const quotedMatch = disposition.match(/filename\s*=\s*"([^"]*)"/i);
        if (quotedMatch) {
            const quotedName = sanitizeFilename(quotedMatch[1]);
            if (quotedName) return quotedName;
            return fallbackName;
        }

        const plainMatch = disposition.match(/filename\s*=\s*([^;]+)/i);
        if (plainMatch) {
            const plainName = sanitizeFilename(plainMatch[1].trim());
            if (plainName) return plainName;
        }

        return fallbackName;
    }

    return {
        normalizeCodes: normalizeCodes,
        courseDownloadSettings: courseDownloadSettings,
        normalizeRestoredMessageRole: normalizeRestoredMessageRole,
        countPersistedStudentMessages: countPersistedStudentMessages,
        buildCompletionMarkerKey: buildCompletionMarkerKey,
        buildPromptDesignerSurveyPayload: buildPromptDesignerSurveyPayload,
        downloadState: downloadState,
        studentFooterState: studentFooterState,
        buildProgressSnapshot: buildProgressSnapshot,
        verificationCandidates: verificationCandidates,
        verificationTarget: verificationTarget,
        verificationControls: verificationControls,
        verificationBatch: verificationBatch,
        summarizeVerification: summarizeVerification,
        filenameFromDisposition: filenameFromDisposition,
    };
});
