(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else {
        root.leaiInstructorHome = api;
        if (root.document) {
            if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', api.init);
            else api.init();
        }
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    function slugSuggestion(name) {
        return String(name || '')
            .trim()
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-+/g, '-');
    }

    function isAllowedInstructorEmail(value) {
        var email = String(value || '').trim().toLowerCase();
        return /^[^\s@]+@ucsc\.edu$/.test(email);
    }

    function profilePatch(account, displayName, email) {
        var current = account || {};
        var nextDisplayName = String(displayName || '').trim();
        var nextEmail = String(email || '').trim().toLowerCase();
        var patch = {};
        if (nextDisplayName !== String(current.display_name || '').trim()) {
            patch.display_name = nextDisplayName;
        }
        if (nextEmail !== String(current.email || '').trim().toLowerCase()) {
            patch.email = nextEmail;
        }
        return patch;
    }

    function institutionName(account, slug) {
        if (slug === 'ucsc') return 'University of California, Santa Cruz';
        var institutions = account && Array.isArray(account.institutions) ? account.institutions : [];
        var match = institutions.find(function (institution) { return institution.slug === slug; });
        return match ? match.name : slug;
    }

    function courseCardViewModel(course, account, session) {
        var role = String(course.role || 'member');
        return {
            courseId: course.course_id,
            courseName: course.course_name,
            institutionName: institutionName(account, course.institution_slug),
            roleLabel: role.charAt(0).toUpperCase() + role.slice(1),
            isCurrent: Boolean(session && session.courseId === course.course_id),
        };
    }

    function init() {
        var document = root.document;
        var auth = root.leaiInstructorAuth;
        var apiBase = typeof API !== 'undefined' ? API : root.API;
        if (!document || !auth) return;

        var account = null;
        var temporaryCurrentPassword = null;
        var courseIdWasEdited = false;
        var currentView = 'courses';
        var createDrawerTrigger = null;
        var mobileDrawerTrigger = null;

        function byId(id) { return document.getElementById(id); }

        function setHidden(id, hidden) {
            var element = byId(id);
            if (element) element.hidden = hidden;
        }

        function session() {
            if (typeof root.getSession === 'function') return root.getSession();
            try { return JSON.parse(root.sessionStorage.getItem('leai_session')); } catch (error) { return null; }
        }

        function persist(nextSession) {
            if (typeof root.saveSession === 'function') root.saveSession(nextSession);
            else root.sessionStorage.setItem('leai_session', JSON.stringify(nextSession));
        }

        function clearStoredSession() {
            if (typeof root.clearSession === 'function') root.clearSession();
            else root.sessionStorage.removeItem('leai_session');
        }

        function announce(message) { byId('home-live-region').textContent = message; }

        function message(id, text, kind) {
            var element = byId(id);
            element.textContent = text || '';
            element.className = 'status-message' + (text ? ' msg msg-' + (kind || 'error') : '');
        }

        function setBusy(button, busy, busyLabel) {
            if (!button) return;
            if (busy) {
                button.dataset.normalLabel = button.textContent;
                button.textContent = busyLabel;
            } else if (button.dataset.normalLabel) {
                button.textContent = button.dataset.normalLabel;
                delete button.dataset.normalLabel;
            }
            button.disabled = busy;
        }

        function showGateway(viewId) {
            setHidden('home-auth-view', viewId !== 'home-auth-view');
            setHidden('home-password-view', viewId !== 'home-password-view');
            setHidden('home-shell', true);
        }

        function showSignedOut(notice) {
            account = null;
            temporaryCurrentPassword = null;
            currentView = 'courses';
            closeCreateDrawer(false);
            closeMobileDrawer(false);
            showGateway('home-auth-view');
            byId('home-email').value = '';
            byId('home-password').value = '';
            byId('setup-new-password').value = '';
            byId('setup-confirm-password').value = '';
            byId('account-current-password').value = '';
            byId('account-new-password').value = '';
            byId('account-confirm-password').value = '';
            message('account-profile-message', '');
            message('account-password-message', '');
            message('home-signin-message', notice || '', notice ? 'error' : 'error');
            root.setTimeout(function () { byId('home-email').focus(); }, 0);
        }

        function accountSession(nextAccount) {
            var stored = session() || {};
            return Object.assign({}, stored, {
                instructorEmail: nextAccount.email,
                instructorDisplayName: nextAccount.display_name,
                mustChangePassword: nextAccount.must_change_password === true,
            });
        }

        function activeCourses() {
            return account && Array.isArray(account.courses) ? account.courses.slice() : [];
        }

        function selectedCourseStillExists(courses, stored) {
            return Boolean(stored && stored.courseId && courses.some(function (course) {
                return course.course_id === stored.courseId;
            }));
        }

        function renderAccountIdentity() {
            var displayName = account.display_name || 'Instructor';
            ['rail-account-name', 'mobile-account-name'].forEach(function (id) { byId(id).textContent = displayName; });
            byId('courses-greeting').textContent = 'Welcome, ' + displayName + '. Open a course to manage its feedback workspace.';
            byId('account-display-name').value = account.display_name || '';
            byId('account-email').value = account.email || '';
        }

        function appendText(parent, className, value) {
            var element = document.createElement('div');
            element.className = className;
            element.textContent = value;
            parent.appendChild(element);
            return element;
        }

        function continueIntoCourse(course) {
            var nextSession = root.leaiInstructorAuth.selectCourse(session(), course);
            persist(nextSession);
            root.location.href = 'PromptDesigner.html';
        }

        function renderCourses() {
            var grid = byId('course-grid');
            var empty = byId('course-empty-state');
            var stored = session();
            var courses = activeCourses();
            var notice = byId('courses-notice');

            if (stored && stored.courseId && !selectedCourseStillExists(courses, stored)) {
                var cleaned = Object.assign({}, stored);
                delete cleaned.courseId;
                delete cleaned.courseName;
                persist(cleaned);
                stored = cleaned;
                notice.textContent = 'Your previously selected course is no longer available. Choose another course to continue.';
                notice.hidden = false;
            } else {
                notice.hidden = true;
                notice.textContent = '';
            }

            courses.sort(function (left, right) {
                var leftCurrent = stored && left.course_id === stored.courseId ? 0 : 1;
                var rightCurrent = stored && right.course_id === stored.courseId ? 0 : 1;
                if (leftCurrent !== rightCurrent) return leftCurrent - rightCurrent;
                var nameOrder = String(left.course_name || '').localeCompare(String(right.course_name || ''));
                return nameOrder || String(left.course_id || '').localeCompare(String(right.course_id || ''));
            });

            grid.textContent = '';
            grid.hidden = courses.length === 0;
            empty.hidden = courses.length !== 0;
            courses.forEach(function (course) {
                var card = document.createElement('button');
                var model = courseCardViewModel(course, account, stored);
                card.type = 'button';
                card.className = 'course-card';
                card.setAttribute('aria-label', 'Open ' + model.courseName + ', ' + model.courseId);
                card.addEventListener('click', function () { continueIntoCourse(course); });

                var accent = document.createElement('div');
                accent.className = 'course-accent';
                accent.setAttribute('aria-hidden', 'true');
                card.appendChild(accent);
                var body = document.createElement('div');
                body.className = 'course-card-body';
                card.appendChild(body);
                var top = document.createElement('div');
                top.className = 'course-card-top';
                body.appendChild(top);
                appendText(top, 'course-name', model.courseName);
                if (model.isCurrent) appendText(top, 'current-mark', 'Current');
                appendText(body, 'course-id', model.courseId);
                var meta = document.createElement('div');
                meta.className = 'course-meta';
                body.appendChild(meta);
                appendText(meta, '', model.institutionName || 'Institution not listed');
                appendText(meta, '', model.roleLabel);
                appendText(body, 'course-open', 'Open course →');
                grid.appendChild(card);
            });
        }

        function showView(name, focusMain) {
            currentView = name;
            var courses = name === 'courses';
            setHidden('courses-view', !courses);
            setHidden('account-view', courses);
            [['courses-nav', courses], ['mobile-courses-nav', courses], ['account-nav', !courses], ['mobile-account-nav', !courses]].forEach(function (item) {
                if (item[1]) byId(item[0]).setAttribute('aria-current', 'page');
                else byId(item[0]).removeAttribute('aria-current');
            });
            if (focusMain) byId('home-main').focus();
            announce(courses ? 'Courses view' : 'Account view');
        }

        function showWorkspace(nextAccount) {
            account = nextAccount;
            persist(accountSession(account));
            setHidden('home-auth-view', true);
            setHidden('home-password-view', true);
            setHidden('home-shell', false);
            renderAccountIdentity();
            renderCourses();
            showView(currentView, false);
        }

        function handleSessionError(error, fallback) {
            if (error && (error.status === 401 || error.code === 'authentication_required')) {
                clearStoredSession();
                showSignedOut('Your session expired. Sign in again to continue.');
                return;
            }
            message(fallback, 'LEAI could not connect. Check your connection and try again.', 'error');
        }

        function loadWorkspace(allowRequiredChange) {
            var stored = session();
            return auth.getAccount(root.fetch, apiBase, stored.instructorToken).then(function (nextAccount) {
                persist(accountSession(nextAccount));
                if (nextAccount.must_change_password) {
                    if (allowRequiredChange && temporaryCurrentPassword) {
                        account = nextAccount;
                        showGateway('home-password-view');
                        root.setTimeout(function () { byId('setup-new-password').focus(); }, 0);
                        return;
                    }
                    return auth.signOut(root.fetch, apiBase, stored.instructorToken).catch(function () {}).then(function () {
                        clearStoredSession();
                        showSignedOut('Sign in again to finish choosing your permanent password.');
                    });
                }
                showWorkspace(nextAccount);
            });
        }

        function fieldError(id, text) {
            var input = byId(id);
            var error = byId(id + '-error');
            input.setAttribute('aria-invalid', text ? 'true' : 'false');
            error.textContent = text || '';
            error.hidden = !text;
        }

        function clearCourseErrors() {
            ['course-institution', 'course-name', 'course-id', 'course-instructor-name'].forEach(function (id) { fieldError(id, ''); });
            message('create-course-message', '');
        }

        function focusableElements(container) {
            return Array.from(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (element) {
                return !element.hidden && element.getAttribute('aria-hidden') !== 'true';
            });
        }

        function trapTab(event, container) {
            if (event.key !== 'Tab') return;
            var focusable = focusableElements(container);
            if (!focusable.length) return;
            var first = focusable[0];
            var last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        }

        function populateInstitutions() {
            var select = byId('course-institution');
            var institutions = account && Array.isArray(account.institutions) ? account.institutions : [];
            select.textContent = '';
            if (institutions.length > 1) {
                var prompt = document.createElement('option');
                prompt.value = '';
                prompt.textContent = 'Choose an institution';
                select.appendChild(prompt);
            }
            institutions.forEach(function (institution) {
                var option = document.createElement('option');
                option.value = institution.slug;
                option.textContent = institutionName(account, institution.slug);
                select.appendChild(option);
            });
            select.disabled = institutions.length === 0;
            var blocked = byId('create-course-blocked');
            blocked.hidden = institutions.length > 0;
            blocked.textContent = institutions.length ? '' : 'An administrator must assign your account to an institution before you can create a course.';
            byId('create-course-submit').disabled = institutions.length === 0;
        }

        function openCreateDrawer(event) {
            createDrawerTrigger = event && event.currentTarget ? event.currentTarget : document.activeElement;
            courseIdWasEdited = false;
            clearCourseErrors();
            populateInstitutions();
            byId('course-name').value = '';
            byId('course-id').value = '';
            byId('course-instructor-name').value = account.display_name || '';
            setHidden('create-course-scrim', false);
            setHidden('create-course-drawer', false);
            document.body.style.overflow = 'hidden';
            root.setTimeout(function () {
                if (byId('course-institution').disabled) byId('create-course-close').focus();
                else byId('course-institution').focus();
            }, 0);
        }

        function closeCreateDrawer(restoreFocus) {
            var drawer = byId('create-course-drawer');
            if (!drawer || drawer.hidden) return;
            setHidden('create-course-scrim', true);
            setHidden('create-course-drawer', true);
            document.body.style.overflow = '';
            if (restoreFocus !== false && createDrawerTrigger && typeof createDrawerTrigger.focus === 'function') createDrawerTrigger.focus();
            createDrawerTrigger = null;
        }

        function openMobileDrawer(event) {
            mobileDrawerTrigger = event && event.currentTarget ? event.currentTarget : document.activeElement;
            setHidden('mobile-nav-scrim', false);
            setHidden('mobile-nav-drawer', false);
            byId('mobile-nav-open').setAttribute('aria-expanded', 'true');
            document.body.style.overflow = 'hidden';
            root.setTimeout(function () { byId('mobile-nav-close').focus(); }, 0);
        }

        function closeMobileDrawer(restoreFocus) {
            var drawer = byId('mobile-nav-drawer');
            if (!drawer || drawer.hidden) return;
            setHidden('mobile-nav-scrim', true);
            setHidden('mobile-nav-drawer', true);
            byId('mobile-nav-open').setAttribute('aria-expanded', 'false');
            document.body.style.overflow = '';
            if (restoreFocus !== false && mobileDrawerTrigger && typeof mobileDrawerTrigger.focus === 'function') mobileDrawerTrigger.focus();
            mobileDrawerTrigger = null;
        }

        function signOut() {
            var stored = session();
            var buttons = [byId('rail-signout-button'), byId('mobile-signout-button')];
            buttons.forEach(function (button) { button.disabled = true; });
            auth.signOut(root.fetch, apiBase, stored && stored.instructorToken).catch(function () {}).then(function () {
                clearStoredSession();
                closeMobileDrawer(false);
                showSignedOut();
                announce('Signed out');
            }).finally(function () { buttons.forEach(function (button) { button.disabled = false; }); });
        }

        byId('home-signin-form').addEventListener('submit', function (event) {
            event.preventDefault();
            var email = byId('home-email').value;
            var password = byId('home-password').value;
            if (!auth.normalizeEmail(email) || !password) {
                message('home-signin-message', 'Enter your email address and password.', 'error');
                (auth.normalizeEmail(email) ? byId('home-password') : byId('home-email')).focus();
                return;
            }
            var button = byId('home-signin-button');
            setBusy(button, true, 'Signing in…');
            message('home-signin-message', '');
            auth.signIn(root.fetch, apiBase, email, password).then(function (nextSession) {
                temporaryCurrentPassword = password;
                persist(Object.assign({}, nextSession, { instructorEmail: auth.normalizeEmail(email) }));
                return loadWorkspace(true);
            }).catch(function (error) {
                temporaryCurrentPassword = null;
                clearStoredSession();
                message('home-signin-message', error.code === 'invalid_credentials'
                    ? 'That email address or password is incorrect.'
                    : 'Could not sign in. Please try again.', 'error');
            }).finally(function () {
                byId('home-password').value = '';
                setBusy(button, false);
            });
        });

        byId('setup-password-form').addEventListener('submit', function (event) {
            event.preventDefault();
            var nextPassword = byId('setup-new-password').value;
            var confirmation = byId('setup-confirm-password').value;
            if (!nextPassword || nextPassword !== confirmation) {
                message('setup-password-message', 'Enter the same new password in both fields.', 'error');
                (nextPassword ? byId('setup-confirm-password') : byId('setup-new-password')).focus();
                return;
            }
            if (!temporaryCurrentPassword) {
                clearStoredSession();
                showSignedOut('Sign in again to change your temporary password.');
                return;
            }
            var stored = session();
            var button = byId('setup-password-button');
            setBusy(button, true, 'Saving…');
            auth.changePassword(root.fetch, apiBase, stored.instructorToken, temporaryCurrentPassword, nextPassword)
                .then(function () {
                    temporaryCurrentPassword = null;
                    byId('setup-new-password').value = '';
                    byId('setup-confirm-password').value = '';
                    persist(Object.assign({}, session(), { mustChangePassword: false }));
                    return loadWorkspace(false);
                })
                .catch(function (error) {
                    var detail = error.details && error.details.length ? error.details.join(' ') : '';
                    message('setup-password-message', detail || (error.code === 'invalid_current_password'
                        ? 'Your temporary password is no longer valid. Sign in again.'
                        : 'Could not change your password. Please try again.'), 'error');
                })
                .finally(function () { setBusy(button, false); });
        });

        [['courses-nav', 'courses'], ['account-nav', 'account'], ['mobile-courses-nav', 'courses'], ['mobile-account-nav', 'account']].forEach(function (item) {
            byId(item[0]).addEventListener('click', function () {
                closeMobileDrawer(false);
                showView(item[1], true);
            });
        });
        [byId('create-course-trigger'), byId('empty-create-course-trigger')].forEach(function (button) { button.addEventListener('click', openCreateDrawer); });
        [byId('create-course-close'), byId('create-course-cancel'), byId('create-course-scrim')].forEach(function (element) { element.addEventListener('click', function () { closeCreateDrawer(true); }); });
        byId('mobile-nav-open').addEventListener('click', openMobileDrawer);
        [byId('mobile-nav-close'), byId('mobile-nav-scrim')].forEach(function (element) { element.addEventListener('click', function () { closeMobileDrawer(true); }); });
        [byId('rail-signout-button'), byId('mobile-signout-button')].forEach(function (button) { button.addEventListener('click', signOut); });

        byId('create-course-drawer').addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); closeCreateDrawer(true); }
            else trapTab(event, byId('create-course-drawer'));
        });
        byId('mobile-nav-drawer').addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); closeMobileDrawer(true); }
            else trapTab(event, byId('mobile-nav-drawer'));
        });

        byId('course-name').addEventListener('input', function () {
            fieldError('course-name', '');
            if (!courseIdWasEdited) byId('course-id').value = slugSuggestion(this.value);
        });
        byId('course-id').addEventListener('input', function () {
            courseIdWasEdited = true;
            this.value = this.value.toLowerCase();
            fieldError('course-id', '');
        });
        ['course-institution', 'course-instructor-name'].forEach(function (id) {
            byId(id).addEventListener('input', function () { fieldError(id, ''); });
        });

        byId('create-course-form').addEventListener('submit', function (event) {
            event.preventDefault();
            clearCourseErrors();
            var values = {
                institution_slug: byId('course-institution').value,
                course_name: byId('course-name').value.trim(),
                course_id: byId('course-id').value.trim().toLowerCase(),
                instructor_name: byId('course-instructor-name').value.trim(),
            };
            var firstInvalid = null;
            if (!values.institution_slug) { fieldError('course-institution', 'Choose an institution.'); firstInvalid = firstInvalid || byId('course-institution'); }
            if (!values.course_name) { fieldError('course-name', 'Enter a course name.'); firstInvalid = firstInvalid || byId('course-name'); }
            if (!values.course_id || !/^[a-z0-9-]+$/.test(values.course_id)) { fieldError('course-id', 'Use lowercase letters, numbers, and hyphens only.'); firstInvalid = firstInvalid || byId('course-id'); }
            if (!values.instructor_name) { fieldError('course-instructor-name', 'Enter the instructor name shown for this course.'); firstInvalid = firstInvalid || byId('course-instructor-name'); }
            if (firstInvalid) { firstInvalid.focus(); message('create-course-message', 'Review the highlighted fields.', 'error'); return; }

            var button = byId('create-course-submit');
            setBusy(button, true, 'Creating…');
            auth.createCourse(root.fetch, apiBase, session().instructorToken, values).then(function (course) {
                announce('Course created. Opening ' + course.course_name + '.');
                continueIntoCourse(course);
            }).catch(function (error) {
                if (error.status === 401 || error.code === 'authentication_required') {
                    clearStoredSession(); closeCreateDrawer(false); showSignedOut('Your session expired. Sign in again to continue.'); return;
                }
                if (error.code === 'course_id_taken') {
                    fieldError('course-id', 'That course ID is already in use. Choose a different one.');
                    byId('course-id').focus();
                    message('create-course-message', 'Choose a different course ID.', 'error');
                } else if (error.code === 'institution_access_denied') {
                    fieldError('course-institution', 'Your account no longer has access to this institution.');
                    byId('course-institution').focus();
                    message('create-course-message', 'Institution access changed. Your entries are still here.', 'error');
                } else message('create-course-message', 'Could not create the course. Your entries are still here; please try again.', 'error');
            }).finally(function () { setBusy(button, false); });
        });

        byId('account-profile-form').addEventListener('submit', function (event) {
            event.preventDefault();
            var displayName = byId('account-display-name').value.trim();
            var email = byId('account-email').value.trim().toLowerCase();
            if (!displayName) { message('account-profile-message', 'Enter a display name.', 'error'); byId('account-display-name').focus(); return; }
            var patch = profilePatch(account, displayName, email);
            if (Object.prototype.hasOwnProperty.call(patch, 'email') && !isAllowedInstructorEmail(patch.email)) { message('account-profile-message', 'Enter your @ucsc.edu email address.', 'error'); byId('account-email').focus(); return; }
            if (!Object.keys(patch).length) { message('account-profile-message', 'No changes to save.', 'success'); return; }
            var button = byId('account-profile-button');
            setBusy(button, true, 'Saving…');
            message('account-profile-message', '');
            auth.updateProfile(root.fetch, apiBase, session().instructorToken, patch).then(function (nextAccount) {
                account = nextAccount;
                persist(accountSession(account));
                renderAccountIdentity();
                message('account-profile-message', 'Profile saved.', 'success');
                announce('Profile saved');
            }).catch(function (error) {
                if (error.code === 'invalid_email') {
                    message('account-profile-message', 'Enter your @ucsc.edu email address.', 'error');
                    byId('account-email').focus();
                } else if (error.code === 'email_in_use') {
                    message('account-profile-message', 'That email address is already connected to another account.', 'error');
                    byId('account-email').focus();
                } else handleSessionError(error, 'account-profile-message');
            })
                .finally(function () { setBusy(button, false); });
        });

        byId('account-password-form').addEventListener('submit', function (event) {
            event.preventDefault();
            var currentPassword = byId('account-current-password').value;
            var nextPassword = byId('account-new-password').value;
            var confirmation = byId('account-confirm-password').value;
            if (!currentPassword) { message('account-password-message', 'Enter your current password.', 'error'); byId('account-current-password').focus(); return; }
            if (!nextPassword || nextPassword !== confirmation) { message('account-password-message', 'Enter the same new password in both new-password fields.', 'error'); (nextPassword ? byId('account-confirm-password') : byId('account-new-password')).focus(); return; }
            var button = byId('account-password-button');
            setBusy(button, true, 'Changing…');
            message('account-password-message', '');
            auth.changePassword(root.fetch, apiBase, session().instructorToken, currentPassword, nextPassword).then(function () {
                byId('account-current-password').value = '';
                byId('account-new-password').value = '';
                byId('account-confirm-password').value = '';
                message('account-password-message', 'Password changed. Your current session is still active.', 'success');
                announce('Password changed');
            }).catch(function (error) {
                if (error.code === 'invalid_current_password') message('account-password-message', 'Your current password is incorrect.', 'error');
                else if (error.details && error.details.length) message('account-password-message', error.details.join(' '), 'error');
                else handleSessionError(error, 'account-password-message');
            }).finally(function () { setBusy(button, false); });
        });

        var stored = session();
        if (!auth.hasUsableInstructorSession(stored)) {
            if (stored && stored.instructorToken) clearStoredSession();
            showSignedOut(stored && stored.instructorToken ? 'Your session expired. Sign in again to continue.' : '');
        } else {
            loadWorkspace(false).catch(function (error) { handleSessionError(error, 'home-signin-message'); });
        }
    }

    return {
        slugSuggestion: slugSuggestion,
        isAllowedInstructorEmail: isAllowedInstructorEmail,
        profilePatch: profilePatch,
        institutionName: institutionName,
        courseCardViewModel: courseCardViewModel,
        init: init,
    };
}));
