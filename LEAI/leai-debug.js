// Optional researcher display. Debug never participates in student persistence.
(function(root){
    'use strict';
    const AUTH_KEY='leai_debug_auth';
    function getAuth(courseId) {
        try {
            const auth=JSON.parse(root.localStorage.getItem(AUTH_KEY)||'null');
            if (!auth || !auth.token || !Number.isFinite(Date.parse(auth.expiresAt)) || Date.parse(auth.expiresAt)<=Date.now()) return null;
            return !courseId || auth.courseId===courseId ? auth : null;
        } catch (_) { return null; }
    }
    async function request(api,path,query,body) {
        const auth=getAuth(query && query.course_id);
        if (!auth) { const error=new Error('Sign in to this course again to use debug.'); error.status=401; throw error; }
        const url=api+'/legacy_debug/'+path+'/'+(body?'':'?'+new URLSearchParams(query));
        const response=await root.fetch(url,{method:body?'PATCH':'GET',cache:'no-store',
            headers:{'Authorization':'Bearer '+auth.token,...(body?{'Content-Type':'application/json'}:{})},
            ...(body?{body:JSON.stringify(body)}:{})});
        const data=await response.json();
        if (!response.ok) {
            const error=new Error(response.status===401?'Debug login expired. Sign in to the course again.':data.error==='debug_disabled'?'Debug is off for this course.':
                data.error==='settings_conflict'?'Debug settings changed in another window. Review the saved setting and try again.':data.error || 'Debug state unavailable.');
            error.status=response.status; throw error;
        }
        return data;
    }
    function createSettingsClient(api,courseId) {
        let saved;
        return {
            async load(){saved=await request(api,'settings',{course_id:courseId});return saved;},
            async save(enabled){
                if(!saved)throw new Error('Load debug settings before saving.');
                saved=await request(api,'settings',{course_id:courseId},{course_id:courseId,enabled,expected_version:saved.version});
                // Notify other researcher tabs. They re-read the authorized server state.
                try { root.localStorage.setItem('leai_debug_settings_changed',JSON.stringify({courseId,version:saved.version})); } catch (_) {}
                return saved;
            }
        };
    }
    function messageSnapshots(data,messages) {
        const first=messages.find(m=>m.sent_by==='ai-message' && m.form_field_id);
        const intro=messages.find(m=>m.sent_by==='ai-message');
        return messages.filter(m=>m.sent_by==='ai-message').flatMap(message=>{
            let event=data.events.find(e=>e.assistant_sequence===message.sequence);
            if(!event && first===message)event=data.events.find(e=>e.event==='started' && e.after.item_id===message.form_field_id);
            // The saved start transaction contains both the welcome and first question.
            if(!event && message===intro && message.sequence===1)event=data.events.find(e=>e.event==='started');
            return [{sequence:message.sequence,event:event || null}];
        });
    }
    const RESULT_LABELS={answered:'Answered',partial:'Partial answer',declined:'Declined to answer',unknown:'No answer known',not_applicable:'Not applicable',active:'In progress'};
    const ACTION_LABELS={ask_main:'Asked the main question',follow_up:'Asked a follow-up',clarify:'Asked for clarification',review_ready:'Opened review'};
    const CLOSURE_LABELS={no_knowledge:'No answer known',no_more_detail:'No more detail available',refused:'Student declined this part',not_applicable:'Not applicable'};
    const COMPONENT_LABELS={answer:'Answer',rating:'Rating',reflection:'Reflection'};
    const DIAGNOSTIC_LABELS={missing_results:'Required assessment results are missing',stale_assessment:'Assessment belongs to a different turn',stale_binding:'The request changed before saving',schema_validation:'Response did not match the required structure',invalid_evidence:'Answer evidence failed validation',invalid_scale:'Rating did not match the authored scale',invalid_transition:'Conversation action did not match the saved state',provider_output:'Provider response was incomplete or ambiguous',budget_exhausted:'Turn processing budget was exhausted',transport_error:'Provider request failed',proposal_validation:'Proposed update failed validation'};
    function phaseLabel(state) {
        if(state.status==='finalized')return 'Submitted';
        if(state.phase==='complete')return 'Ready for review';
        if(state.last_dialogue_action==='clarify' && state.phase==='probe')return 'Waiting for clarification';
        return {rating:'Waiting for a rating',answer:'Waiting for an answer',probe:'Waiting for a follow-up answer',reflection:'Waiting for a reflection'}[state.phase] || 'Stage not available';
    }
    function resultView(item,state) {
        const result=(state.results || {})[item.id];
        const evidence=(state.evidence || {})[item.id] || [];
        const rating=result?.rating;
        const choice=(item.scale || []).find(c=>c.value===rating);
        return {...item,status:result ? (RESULT_LABELS[result.status] || 'Status not available') : 'Not recorded',
            rating:rating===null || rating===undefined?'Not given':String(rating)+(choice?' — '+choice.label:''),
            probes:result?.probes ?? 0,maxProbes:item.max_additional_probes,
            closure:result?.closure?{label:CLOSURE_LABELS[result.closure.reason] || 'Recorded stopping reason',
                components:(result.closure.components || []).map(c=>COMPONENT_LABELS[c] || c),
                messages:[...new Set((result.closure.evidence || []).map(ref=>ref.sequence))].sort((a,b)=>a-b)}:null,
            messages:[...new Set(evidence.map(ref=>ref.sequence))].sort((a,b)=>a-b),
            targets:(item.coverage_targets || []).map(t=>({...t,status:({covered:'Covered',missing:'Missing',not_applicable:'Not applicable'})[result?.targets?.[t.id]] || 'Not recorded'}))};
    }
    function catalog(data,state) {
        return data.items || [...new Set([...Object.keys(state.results || {}),...(state.item_id?[state.item_id]:[])])].map(id=>({id,prompt:'Question wording unavailable',response:{kind:'unknown'}}));
    }
    function describeState(data,state=data.current || {}) {
        const items=catalog(data,state),question=items.find(item=>item.id===state.item_id);
        const results=items.map(item=>resultView(item,state));
        return {phase:phaseLabel(state),question,results,
            recorded:results.filter(r=>r.status!=='Not recorded').length,total:items.length,
            action:state.status==='finalized'?'Submitted reflection':ACTION_LABELS[state.last_dialogue_action] || 'No dialogue action recorded',
            next:state.status==='finalized'?'No further response needed.':state.phase==='complete'?'Student reviews the answers and submits the reflection.':
                state.last_dialogue_action==='clarify'?'Student clarifies the current answer.':state.phase==='probe'?'Student answers the follow-up question.':
                question?.response?.kind==='likert'?'Student gives a rating and explains it.':'Student answers the current question.'};
    }
    function describeEvent(data,event) {
        const before=event.before || {},after=event.after || {};
        const same=before.version===after.version && before.phase===after.phase && before.item_id===after.item_id;
        let action=ACTION_LABELS[event.action] || 'Request recorded';
        if(event.action==='ask_main' && before.item_id && before.item_id!==after.item_id)action='Moved to the next question';
        const failed={invalid_text:'Input rejected',assessment_unavailable:'AI service unavailable',stale_turn:'Outdated request rejected',session_closed:'Session already closed'};
        if(failed[event.outcome])action=failed[event.outcome];
        if(event.event==='started')action='Started reflection';
        if(event.event==='finalized')action='Submitted reflection';
        const changes=catalog(data,after).filter(item=>JSON.stringify([(before.results || {})[item.id],(before.evidence || {})[item.id],(before.coverage_seen || {})[item.id]])!==
            JSON.stringify([(after.results || {})[item.id],(after.evidence || {})[item.id],(after.coverage_seen || {})[item.id]])).map(item=>resultView(item,after));
        return {action,changes,before:describeState(data,before),after:describeState(data,after),
            outcome:event.event==='started'?'Initial state saved':event.event==='finalized'?'Submission saved':
                event.outcome==='committed'?'Answer and state saved':event.outcome==='ready'?'Initial state saved':
                same?'No answer saved; state unchanged':'Request did not save a new answer'};
    }
    function node(tag,text) { const n=root.document.createElement(tag); if(text!==undefined)n.textContent=text; return n; }
    function describeDecision(event) {
        const value=event.metrics?.decision_explanation;
        if(!value?.action || !Array.isArray(value.items))return {available:false,items:[],label:'No decision justification recorded for this version.'};
        return {available:true,label:value.submission==='committed'?'Saved decision':'Uncommitted proposal',
            attempt:value.attempt,actionJustification:value.action.justification,
            items:value.items.map(item=>({id:item.item_id,status:item.status,justification:item.justification,
                evidence:(item.evidence || []).map(ref=>({sequence:ref.sequence,quote:ref.quote}))}))};
    }
    function showDecision(parent,event) {
        if(event.event==='started' || event.event==='finalized')return;
        const view=describeDecision(event),section=node('section');section.dataset.decisionExplanation='';
        section.appendChild(node('h3','Why this decision'));
        if(!view.available){section.appendChild(node('p',view.label));parent.appendChild(section);return;}
        section.appendChild(node('p',view.label+(view.attempt?' · attempt '+view.attempt:'')));
        section.appendChild(node('p',view.actionJustification));
        for(const item of view.items){
            section.appendChild(node('h4',item.id+' · '+(RESULT_LABELS[item.status] || item.status)));
            section.appendChild(node('p',item.justification));
            for(const ref of item.evidence){const quote=node('blockquote',ref.quote);
                section.appendChild(node('p','Student message #'+ref.sequence));section.appendChild(quote);}
        }
        parent.appendChild(section);
    }
    function disclosure(title) {
        const details=node('details');details.className='leai-debug';
        details.appendChild(node('summary',title));return details;
    }
    function addStyles(details) {
        const style=node('style',`
.leai-debug{font:14px/1.5 system-ui;color:var(--text,#27323a);border:1px solid var(--border,#ccd5da);border-radius:5px;padding:12px 14px;margin:12px 0;overflow-wrap:anywhere;white-space:normal;min-width:0;box-sizing:border-box}
.leai-debug summary{cursor:pointer;font-weight:600}.leai-debug summary:focus-visible,.leai-debug button:focus-visible,.leai-debug a:focus-visible{outline:2px solid #155e75;outline-offset:3px}
.leai-debug p{margin:6px 0}.leai-debug h3{font-size:14px;font-weight:600;margin:18px 0 6px}.leai-debug h4{font-size:14px;font-weight:600;margin:8px 0 4px}
.leai-debug .debug-stage{font-size:20px;font-weight:600;line-height:1.25;margin:12px 0 6px}.leai-debug .debug-muted{color:#52636e;font-size:12px}
.leai-debug .debug-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px;margin:12px 0}.leai-debug dt{font-size:12px;color:#52636e}.leai-debug dd{margin:2px 0 0}
.leai-debug .debug-history{display:grid;gap:8px}.leai-debug .debug-event{border-top:1px solid var(--border,#ccd5da);padding-top:8px}.leai-debug .debug-event summary{font-weight:500}
.leai-debug table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}.leai-debug th{text-align:left;font-size:12px;color:#52636e}.leai-debug th,.leai-debug td{padding:7px 6px;vertical-align:top;border-bottom:1px solid var(--border,#ccd5da);white-space:normal;overflow-wrap:anywhere}
.leai-debug th:first-child{width:44%}.leai-debug th:nth-child(2){width:26%}.leai-debug .debug-notice{padding:8px 10px;background:#fff4df;color:#704318;border-radius:4px}
.leai-debug button{margin:12px 0 2px;padding:6px 10px;border:1px solid var(--border,#ccd5da);border-radius:4px;background:var(--surface,#fff);color:inherit;cursor:pointer}.leai-debug button:hover{background:#edf2f5}.leai-debug button:disabled{opacity:.6;cursor:wait}
.leai-debug .debug-export-link{display:block;margin:5px 0;color:#155e75;text-decoration:underline}.leai-debug blockquote{margin:6px 0;padding-left:10px;border-left:1px solid #82939e;white-space:pre-wrap}
@media(max-width:520px){.leai-debug{padding:10px}.leai-debug .debug-grid{grid-template-columns:1fr}.leai-debug table{font-size:12px}.leai-debug th,.leai-debug td{padding:6px 3px}}
`);details.appendChild(style);
    }
    function field(grid,label,value) {const pair=node('div');pair.append(node('dt',label),node('dd',value));grid.appendChild(pair);}
    function showEvidence(parent,results) {
        for(const result of results){
            const part=node('section');part.appendChild(node('h4',result.id+' · '+result.status));
            part.appendChild(node('p',result.prompt));
            part.appendChild(node('p',(result.response?.kind==='likert'?'Rating: '+result.rating+' · ':'')+'Follow-ups: '+result.probes+(result.maxProbes!==undefined?' / '+result.maxProbes:'')));
            part.appendChild(node('p','Linked student messages: '+(result.messages.length?result.messages.map(n=>'#'+n).join(', '):'None recorded')));
            if(result.closure)part.appendChild(node('p','Stopped: '+result.closure.label+' · '+result.closure.components.join(', ')+
                ' · Student '+result.closure.messages.map(n=>'#'+n).join(', ')));
            for(const target of result.targets)part.appendChild(node('p',target.status+' — '+target.description));
            parent.appendChild(part);
        }
    }
    function showEvent(parent,data,event,open=false) {
        const view=describeEvent(data,event),details=node('details');details.className='debug-event';details.open=open;
        const time=new Date(event.created_at).toLocaleString();
        const label=event.student_sequence?'Student message #'+event.student_sequence+' → AI message #'+event.assistant_sequence:time;
        details.appendChild(node('summary',view.action+' · '+label));
        details.appendChild(node('p',view.outcome));
        if(event.student_sequence){const stamp=node('p',time);stamp.className='debug-muted';details.appendChild(stamp);}
        if(event.before?.phase){const transition=node('dl');transition.className='debug-grid';
            field(transition,'Before',(event.before.item_id || 'Review')+' · '+view.before.phase);
            field(transition,'After',(event.after.item_id || 'Review')+' · '+view.after.phase);details.appendChild(transition);}
        if(view.changes.length)showEvidence(details,view.changes);
        else details.appendChild(node('p',event.event==='started'?'No student answer recorded yet.':'No question result changed in this event.'));
        showDecision(details,event);
        const metrics=event.metrics || {},calls=metrics.calls || [];
        if(calls.length || metrics.turn_processing_ms!==undefined){
            const timings=node('details');timings.appendChild(node('summary','Model and timing'));
            if(metrics.turn_processing_ms!==undefined)timings.appendChild(node('p','Turn processing: '+(metrics.turn_processing_ms/1000).toFixed(2)+' seconds'));
            for(const call of calls){const grid=node('dl');grid.className='debug-grid';
                field(grid,'Model',call.model || 'Not recorded');
                if(call.stage)field(grid,'Role',({assessment:'Answer assessment',dialogue:'Conversation',proposal:'Conversation proposal',unified:'Interpretation and conversation'})[call.stage] || 'Processing');
                if(call.duration_ms!==undefined)field(grid,'Response time',(call.duration_ms/1000).toFixed(2)+' seconds');
                if(call.input_tokens!==undefined)field(grid,'Input tokens',call.input_tokens);
                if(call.output_tokens!==undefined)field(grid,'Output tokens',call.output_tokens);
                timings.appendChild(grid);}
            details.appendChild(timings);
        }
        for(const issue of metrics.diagnostics || [])details.appendChild(node('p',
            (issue.stage==='assessment'?'Answer assessment':issue.stage==='dialogue'?'Conversation':'Processing')+': '+
            (DIAGNOSTIC_LABELS[issue.category] || 'Recorded validation failure')+' · attempt '+issue.attempt));
        parent.appendChild(details);
    }
    function render(container,data,live) {
        container.replaceChildren();
        const view=describeState(data),stage=node('p',view.phase);stage.className='debug-stage';container.appendChild(stage);
        const description=node('p','Saved decisions and answer links.');description.className='debug-muted';container.appendChild(description);
        if(view.question){container.appendChild(node('p',(view.question.section_title?view.question.section_title+' · ':'')+view.question.id+' · Question '+(data.items?data.items.findIndex(i=>i.id===view.question.id)+1:(data.current.item_index??0)+1)+(data.items?' of '+data.items.length:'')));
            container.appendChild(node('p',view.question.prompt));}
        const grid=node('dl');grid.className='debug-grid';
        field(grid,'Current decision',view.action);field(grid,'Next step',view.next);
        field(grid,'Question results',view.recorded+' / '+view.total+' recorded');field(grid,'Saved state','Version '+data.version);
        container.appendChild(grid);
        if(data.history_incomplete){const notice=node('p','Some earlier turns were not recorded while debug was off. Current saved answers are shown below; missing turn states are unavailable.');notice.className='debug-notice';container.appendChild(notice);}
        if(data.events.length){container.appendChild(node('h3',live?'Latest recorded event':'Recorded turns · '+data.events.length));
            const history=node('div');history.className='debug-history';for(const event of (live?data.events.slice(-1):data.events))showEvent(history,data,event);container.appendChild(history);}
        else container.appendChild(node('p','No turn history recorded yet.'));
        const questions=node('details');questions.appendChild(node('summary','Question results · '+view.recorded+' / '+view.total+' recorded'));questions.open=!live;
        const table=node('table'),thead=node('thead'),head=node('tr');
        for(const title of ['Question','Saved result','Follow-ups'])head.appendChild(node('th',title));thead.appendChild(head);table.appendChild(thead);
        const tbody=node('tbody');
        for(const result of view.results){const row=node('tr'),question=node('td'),answer=node('td');
            question.append(node('strong',result.id+(data.current.item_id===result.id?' · Current':'')),node('p',result.prompt));
            answer.appendChild(node('p',result.status));if(result.response?.kind==='likert')answer.appendChild(node('p','Rating: '+result.rating));
            if(result.closure)answer.appendChild(node('p',result.closure.label+' · '+result.closure.components.join(', ')));
            if(result.messages.length || result.targets.length){const evidence=node('details');evidence.appendChild(node('summary','Answer links and coverage'));showEvidence(evidence,[result]);answer.appendChild(evidence);}
            row.append(question,answer,node('td',result.probes+(result.maxProbes!==undefined?' / '+result.maxProbes:'')));tbody.appendChild(row);}
        table.appendChild(tbody);questions.appendChild(table);
        questions.appendChild(node('p','Follow-ups count the saved follow-up action. Clarification requests do not use this budget.'));
        container.appendChild(questions);
        const footer=node('p',(data.title || data.schema_id)+' · '+data.schema_version);footer.className='debug-muted';container.appendChild(footer);
        const exportButton=node('button','Export debug JSON');exportButton.type='button';
        let exportUrl;
        exportButton.addEventListener('click',()=>{
            if(exportUrl)root.URL.revokeObjectURL(exportUrl);
            exportUrl=root.URL.createObjectURL(new root.Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
            let link=container.querySelector('[data-debug-export]');
            if(!link){link=node('a','Download debug JSON');link.dataset.debugExport='';link.className='debug-export-link';container.appendChild(link);}
            link.href=exportUrl;link.download='leai-debug-'+String(data.session_id).replace(/[^a-zA-Z0-9_-]/g,'_')+'-v'+data.version+'.json';
            link.click();
        });container.appendChild(exportButton);
        return ()=>{if(exportUrl)root.URL.revokeObjectURL(exportUrl);};
    }
    function createPanel(api,publicId,sessionId,{live=false,messageContainer}={}) {
        if(!getAuth())return null;
        const details=disclosure('Recorded schema state');addStyles(details);
        if(live){details.hidden=true;details.open=true;}
        const status=node('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');details.appendChild(status);
        const content=node('div');details.appendChild(content);
        let generation=0,version=null,available=false,waiting=false,lastFailure=null,disposeExport=()=>{};
        function clearReplyStates(){messageContainer?.querySelectorAll('[data-debug-message]').forEach(element=>element.remove());}
        function showReplyStates(data) {
            if(!messageContainer)return;
            clearReplyStates();
            const articles=[...messageContainer.querySelectorAll('article.msg-ai[data-orchestration-sequence]')];
            const messages=articles.map(article=>({sequence:Number(article.dataset.orchestrationSequence),sent_by:'ai-message',form_field_id:article.dataset.orchestrationItemId || null}));
            for(const snapshot of messageSnapshots(data,messages)){
                const article=articles.find(a=>Number(a.dataset.orchestrationSequence)===snapshot.sequence);
                const state=snapshot.event?.after;
                const panel=disclosure('Recorded schema state · '+(state?(state.item_id || 'Review')+' · '+phaseLabel(state):'Not recorded for this reply'));
                panel.dataset.debugMessage=String(snapshot.sequence);
                if(snapshot.event){
                    const view=describeState(data,state),grid=node('dl');grid.className='debug-grid';
                    field(grid,'Stage',view.phase);field(grid,'Decision',describeEvent(data,snapshot.event).action);
                    field(grid,'Next step',view.next);field(grid,'Saved state','Version '+state.version);
                    panel.appendChild(grid);showEvent(panel,data,snapshot.event,true);
                } else panel.appendChild(node('p','No debug snapshot was saved for this reply.'));
                article.appendChild(panel);
            }
        }
        async function refresh(expected) {
            const id=++generation;
            try{
                const data=await request(api,'session',{public_id:publicId,session_id:sessionId});
                if(id!==generation || waiting || (expected!==undefined&&data.version!==expected))return;
                available=true;details.hidden=false;
                details.querySelector('summary').textContent='Recorded schema state';
                status.textContent=lastFailure?'The last request failed. Showing the last saved state.':'Up to date · saved on the server';disposeExport();disposeExport=render(content,data,live);showReplyStates(data);
            }catch(error){if(id!==generation)return;disposeExport();content.replaceChildren();clearReplyStates();
                if(error.status===404){details.hidden=true;available=false;}
                else {status.textContent=error.message;details.querySelector('summary').textContent='Recorded schema state';}}
        }
        details.addEventListener('toggle',()=>{if(details.open&&!live)refresh();});
        if(live && root.addEventListener)root.addEventListener('storage',event=>{
            if(event.key===AUTH_KEY && !getAuth()){++generation;details.hidden=true;available=false;clearReplyStates();disposeExport();content.replaceChildren();}
            else if(event.key==='leai_debug_settings_changed' && version!==null)refresh(version);
        });
        return {element:details,
            async update(data){version=data.version;waiting=false;lastFailure=null;
                status.textContent='Loading the saved state…';
                const stage=content.querySelector('.debug-stage');if(stage)stage.textContent='Loading saved state';
                await refresh(version);},
            status(info){if(!live || !available)return;
                if(info.phase==='waiting'){lastFailure=null;waiting=true;++generation;
                    status.textContent='Waiting for the server. Showing saved version '+version+' below.';
                    const stage=content.querySelector('.debug-stage');if(stage)stage.textContent='Waiting for the server';}
                else if(info.phase==='failed'){lastFailure=info;waiting=false;status.textContent='The request failed. Last saved state: version '+version+'.';refresh(version);}
                else if(info.phase==='saved' && info.operation==='finalize'){
                    // Finalization returns a document snapshot, not a session payload.
                    // Read its saved terminal state directly rather than waiting for apply.
                    waiting=false;status.textContent='Loading the submitted state…';refresh(version);
                }
                // Session/turn state is shown only after its authoritative response is applied.
            }};
    }
    function mountReview(container,api,publicId,sessionId) {
        const panel=createPanel(api,publicId,sessionId);if(panel)container.appendChild(panel.element);
    }
    function mountSettings(container,api,courseId) {
        container.querySelector('[data-debug-settings]')?.remove();
        if(!getAuth(courseId))return;
        const details=disclosure('Researcher debug · course configuration');addStyles(details);details.dataset.debugSettings='';const status=node('p');status.setAttribute('role','status');
        const label=node('label');const toggle=node('input');toggle.type='checkbox';toggle.disabled=true;label.append(toggle,root.document.createTextNode(' Record and show orchestration debug for this course'));details.append(label,status);container.prepend(details);
        let version;
        async function load(){try{const data=await request(api,'settings',{course_id:courseId});toggle.checked=data.enabled;version=data.version;toggle.disabled=false;status.textContent=data.enabled?'Debug ON · new turns are recorded':'Debug OFF';}catch(e){status.textContent=e.message;}}
        toggle.addEventListener('change',async()=>{toggle.disabled=true;try{const data=await request(api,'settings',{course_id:courseId},{course_id:courseId,enabled:toggle.checked,expected_version:version});version=data.version;toggle.checked=data.enabled;status.textContent=data.enabled?'Debug ON · new turns are recorded':'Debug OFF';}catch(e){status.textContent=e.message;await load();}finally{toggle.disabled=false;}});load();
    }
    root.leaiDebug={getAuth,createPanel,mountReview,mountSettings,createSettingsClient};
    if(typeof module!=='undefined' && module.exports)module.exports={describeState,describeEvent,messageSnapshots,describeDecision};
})(typeof globalThis!=='undefined'?globalThis:this);
