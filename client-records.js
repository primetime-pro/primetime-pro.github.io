(function initClientRecords(global) {
  'use strict';
  const BUCKET = 'minuta-client-records';
  const PAGE = 30;
  const MAX_BYTES = 10 * 1024 * 1024;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  };
  const money = value => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB',maximumFractionDigits:0}).format(value);
  const size = value => value < 1024 * 1024 ? `${Math.ceil(value / 1024)} КБ` : `${(value / 1024 / 1024).toFixed(1)} МБ`;

  async function prepareFile(file) {
    if (!file || file.size < 1 || file.size > MAX_BYTES) throw new Error('file_size');
    const head = new Uint8Array(await file.slice(0,12).arrayBuffer());
    if (head[0]===37 && head[1]===80 && head[2]===68 && head[3]===70 && head[4]===45) {
      return {blob:file,type:'application/pdf',name:file.name.replace(/\.[^.]+$/, '') + '.pdf'};
    }
    const image = (head[0]===255 && head[1]===216 && head[2]===255)
      || (head[0]===137 && head[1]===80 && head[2]===78 && head[3]===71)
      || (String.fromCharCode(...head.slice(0,4))==='RIFF' && String.fromCharCode(...head.slice(8,12))==='WEBP');
    if (!image || !global.createImageBitmap) throw new Error('file_format');
    const bitmap = await global.createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 40000000) throw new Error('image_dimensions');
      const scale = Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(bitmap.width*scale));
      canvas.height = Math.max(1,Math.round(bitmap.height*scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('file_format');
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/webp',0.9));
      if (!blob || blob.size > MAX_BYTES || blob.size===0) throw new Error('file_size');
      return {blob,type:blob.type,name:file.name.replace(/\.[^.]+$/, '') + (blob.type==='image/webp'?'.webp':'.png')};
    } finally { bitmap.close(); }
  }

  function createController(options) {
    const {db,getContext,requireWrites} = options;
    let organization = null, client = null, rows = [], remote = null;
    let generation = 0, loading = false, busy = false, more = false, offset = 0, historyLimit = 8;
    let currentView = 'history';
    let host = null, errorText = '', pending = null;
    const $ = selector => host?.querySelector(selector);
    function token() { return {generation, ...getContext(), organizationId:organization?.id, phone:client?.phone}; }
    function current(t) {
      const now = getContext();
      return t.generation===generation && t.userId===now.userId && t.sessionGeneration===now.sessionGeneration
        && t.organizationId===organization?.id && t.phone===client?.phone;
    }
    function message(error) {
      const code = String(error?.message || '');
      if (/client_record_upload_expired/.test(code)) return 'Срок незавершённой загрузки истёк. Нажмите «Загрузить», чтобы начать заново.';
      if (/file_size/.test(code)) return 'Выберите непустой файл размером до 10 МБ.';
      if (/image_dimensions/.test(code)) return 'Слишком большое разрешение фотографии. Уменьшите её и повторите.';
      if (/file_format/.test(code)) return 'Поддерживаются PDF, JPG, PNG и WebP. Попробуйте другой файл.';
      if (/access_denied|42501|permission|membership|suspended/.test(code)) return 'Нет доступа к этим материалам. Обновите карточку или обратитесь к владельцу.';
      if (/disabled/.test(code)) return 'Файлы и заметки выключены для организации.';
      return 'Не удалось завершить действие. Проверьте соединение и повторите.';
    }
    async function rpc(name,payload) {
      const result = await db.rpc(name,payload);
      if (result.error) throw result.error;
      return result.data;
    }
    function visitOptions() {
      return '<option value="">Без привязки к визиту</option>' + (client?.bookings || []).filter(b=>UUID.test(b.id)).map(b=>
        `<option value="${escape(b.id)}">${escape(date(b.at))} · ${escape(b.title)}</option>`).join('');
    }
    function timeline(kind) {
      const entries = kind === 'history'
        ? (client?.bookings || []).map(b=>({id:b.id,at:b.at,kind:'visit',title:b.title,subtitle:b.status,body:b.payment,can_delete:false}))
        : rows.filter(e=>e.kind==='note').map(e=>({ ...e,at:e.created_at,title:'Заметка',subtitle:e.visit_label,body:e.body}));
      return entries.sort((a,b)=>String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)));
    }
    function entryMarkup(e) {
      return `<article class="cr-event"><span class="cr-event-dot" aria-hidden="true"></span><div class="cr-event-content"><time>${escape(date(e.at))}</time><strong>${escape(e.title)}</strong>${e.subtitle?`<span class="cr-meta">${escape(e.subtitle)}</span>`:''}${e.body?`<p>${escape(e.body)}</p>`:''}${e.kind==='file'?`<button type="button" class="cr-link" data-cr-download="${escape(e.id)}">Скачать · ${escape(size(e.byte_size))}</button>`:''}${e.kind==='note' && e.can_delete?`<button type="button" class="cr-link" data-cr-archive="${escape(e.id)}">Убрать заметку</button>`:''}</div></article>`;
    }
    function render() {
      if (!host || !client) return;
      const open = new Set([...host.querySelectorAll('details[open]')].map(e=>e.dataset.crPanel));
      const drafts = new Map([...host.querySelectorAll('textarea,select')].map(e=>[e.name,e.value]));
      const uploadDraft = $('[data-cr-upload]');
      const noteDraft = $('[data-cr-note]');
      const files = rows.filter(e=>e.kind==='file');
      const history = timeline('history');
      const notes = timeline('notes');
      const enabled = remote?.enabled===true;
      const gate = !remote ? '' : enabled ? '' : `<div class="cr-gate"><p>Файлы и заметки к визитам хранятся в закрытом разделе организации.</p>${remote.can_enable?'<button type="button" class="cr-button" data-cr-enable>Включить файлы и заметки</button>':'<span class="cr-meta">Включить этот раздел может владелец или администратор.</span>'}</div>`;
      const status = `<div class="cr-status" role="status" aria-live="polite">${escape(errorText || (loading?'Загружаем материалы…':''))}${errorText?'<button type="button" class="cr-link" data-cr-reload>Повторить загрузку</button>':''}</div>`;
      host.innerHTML = `<section class="cr-view" data-cr-view="history">
        <div class="cr-timeline">${history.slice(0,historyLimit).map(entryMarkup).join('') || '<p class="cr-empty">История появится после первой записи.</p>'}</div>
        ${history.length>historyLimit?'<button type="button" class="cr-link" data-cr-history-more>Показать ещё</button>':''}<p class="cr-meta cr-history-note">Оплаты показаны по текущему итогу каждого визита.</p></section>
        <section class="cr-view" data-cr-view="notes" hidden>${status}${gate}
        ${enabled?`<details class="cr-composer" data-cr-panel="note"><summary><span>Добавить заметку</span><small>При необходимости привяжите её к визиту</small></summary><form data-cr-note><label>К какому визиту<select name="note_booking">${visitOptions()}</select></label><label>Заметка<textarea name="note" rows="3" maxlength="2000" placeholder="Что важно помнить к следующему посещению" required></textarea></label><button class="cr-button" type="submit">Сохранить</button></form></details>`:''}
        <div class="cr-timeline cr-notes-timeline">${notes.map(entryMarkup).join('') || '<p class="cr-empty">Заметок по визитам пока нет.</p>'}</div>
        ${more?'<button type="button" class="cr-link" data-cr-more>Загрузить более ранние заметки</button>':''}</section>
        <section class="cr-view" data-cr-view="files" hidden>${status}${gate}
        ${enabled?`<details class="cr-composer" data-cr-panel="upload"><summary><span>Добавить файл</span><small>PDF или фото до 10 МБ</small></summary><form data-cr-upload><label class="cr-file-picker">Выбрать файл<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required></label><span class="cr-meta">Фотографии сохраняются без EXIF.</span><label>К какому визиту<select name="file_booking">${visitOptions()}</select></label><button class="cr-button" type="submit">Загрузить</button></form></details>`:''}
        <div class="cr-files">${files.map(f=>`<article class="cr-file"><span class="cr-file-type" aria-hidden="true">${f.mime_type==='application/pdf'?'PDF':'Фото'}</span><div><strong>${escape(f.file_name)}</strong><span class="cr-meta">${escape(size(f.byte_size))} · ${escape(date(f.created_at))}</span>${f.visit_label?`<span class="cr-meta">${escape(f.visit_label)}</span>`:''}<div class="cr-actions"><button type="button" class="cr-link" data-cr-download="${escape(f.id)}">Скачать</button>${f.can_delete?`<button type="button" class="cr-link" data-cr-archive="${escape(f.id)}">Убрать из карточки</button>`:''}</div></div></article>`).join('') || '<p class="cr-empty">Здесь будут документы и фотографии клиента.</p>'}</div>
        ${more?'<button type="button" class="cr-link" data-cr-more>Загрузить более ранние материалы</button>':''}</section>`;
      host.querySelectorAll('details').forEach(el=>{ el.open=open.has(el.dataset.crPanel); });
      setView(currentView);
      host.querySelectorAll('textarea,select').forEach(el=>{ if(drafts.has(el.name)) el.value=drafts.get(el.name); });
      // Keep selected files and unsaved text through refresh/pagination.
      if(enabled && uploadDraft)$('[data-cr-upload]')?.replaceWith(uploadDraft);
      if(enabled && noteDraft)$('[data-cr-note]')?.replaceWith(noteDraft);
      setBusy(busy);
    }
    function setBusy(value) {
      busy=value;
      host?.setAttribute('aria-busy',String(value));
      host?.querySelectorAll('button,input,select,textarea').forEach(el=>{el.disabled=value;});
    }
    async function load(append=false) {
      if (!client || !organization?.id || loading) return;
      const t=token(); loading=true; errorText='';
      try {
        const data=await rpc('get_minuta_client_records',{p_organization:t.organizationId,p_phone:t.phone,p_offset:append?offset:0});
        if(!current(t)) return;
        remote=data; const batch=Array.isArray(data.entries)?data.entries:[];
        more=batch.length>PAGE;
        rows=append?[...new Map([...rows,...batch.slice(0,PAGE)].map(e=>[e.id,e])).values()]:batch.slice(0,PAGE);
        offset=(append?offset:0)+Math.min(batch.length,PAGE);
      } catch(error) {
        if(!current(t)) return;
        if(/PGRST202|schema cache|does not exist/.test(String(error.code)+' '+String(error.message))) {
          errorText='Файлы и заметки пока не подключены. История визитов доступна.';
        } else errorText=message(error);
      } finally { if(current(t)){loading=false;render();} }
    }
    async function mutate(action) {
      if(busy || loading || !requireWrites() || !client || !organization?.id) return;
      const t=token(); setBusy(true); errorText='';
      try { await action(t); if(current(t)){pending=null;await load();} }
      catch(error) { if(current(t)){if(/client_record_upload_expired/.test(String(error?.message)))pending=null;errorText=message(error); host?.querySelectorAll('.cr-status').forEach(status=>{status.textContent=errorText;});} }
      finally { if(current(t))setBusy(false); }
    }
    async function saveNote(form) {
      const body=form.elements.note.value.trim(),booking=form.elements.note_booking.value||null;
      if(!body) return;
      await mutate(async t=>{
        const key=JSON.stringify(['note',booking,body]);
        if(pending?.key!==key)pending={key,id:global.crypto.randomUUID()};
        await rpc('create_minuta_client_record',{p_organization:t.organizationId,p_phone:t.phone,p_id:pending.id,p_booking:booking,p_kind:'note',p_body:body});
        if(current(t)){form.reset();$('.cr-composer')?.removeAttribute('open');}
      });
    }
    async function upload(form) {
      const file=form.elements.file.files[0],booking=form.elements.file_booking.value||null;
      if(!file) return;
      await mutate(async t=>{
        const key=JSON.stringify(['file',booking,file.name,file.size,file.lastModified]);
        if(pending?.key!==key){
          const prepared=await prepareFile(file);
          if(!current(t))return;
          pending={key,id:global.crypto.randomUUID(),prepared};
        }
        if(!current(t))return;
        const attempt=pending, prepared=attempt.prepared;
        const record=await rpc('create_minuta_client_record',{p_organization:t.organizationId,p_phone:t.phone,p_id:attempt.id,p_booking:booking,
          p_kind:'file',p_body:'',p_file_name:prepared.name.slice(0,180),p_mime_type:prepared.type,p_byte_size:prepared.blob.size});
        if(!current(t) || record.ready)return;
        if(!attempt.uploaded){
          const result=await db.storage.from(BUCKET).upload(record.object_path,prepared.blob,{contentType:prepared.type,cacheControl:'0',upsert:false});
          // A lost upload response is safe to retry with the same opaque path.
          if(result.error && !/already exists|duplicate/i.test(result.error.message||''))throw result.error;
          attempt.uploaded=true;
        }
        if(!current(t))return;
        await rpc('complete_minuta_client_file',{p_id:record.id});
        if(current(t))form.reset();
      });
    }
    async function download(id) {
      const row=rows.find(e=>e.id===id && e.kind==='file');
      if(!row || busy)return;
      const t=token(); setBusy(true);
      try {
        const result=await db.storage.from(BUCKET).download(row.object_path);
        if(result.error)throw result.error;
        if(!current(t))return;
        const url=URL.createObjectURL(result.data),link=document.createElement('a');
        link.href=url;link.download=row.file_name;document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
      } catch(error){if(current(t)){host?.querySelectorAll('.cr-status').forEach(status=>{status.textContent=message(error);});}}
      finally {if(current(t))setBusy(false);}
    }
    function bind() {
      host=document.querySelector('#clientRecords');
      if(!host)return;
      host.addEventListener('submit',event=>{
        if(event.target.matches('[data-cr-note]')){event.preventDefault();void saveNote(event.target);}
        if(event.target.matches('[data-cr-upload]')){event.preventDefault();void upload(event.target);}
      });
      host.addEventListener('click',event=>{
        const button=event.target.closest('button'); if(!button || busy)return;
        if(button.hasAttribute('data-cr-reload'))void load();
        if(button.hasAttribute('data-cr-more'))void load(true);
        if(button.hasAttribute('data-cr-history-more')){historyLimit+=12;render();}
        if(button.dataset.crDownload)void download(button.dataset.crDownload);
        if(button.hasAttribute('data-cr-enable'))void mutate(t=>rpc('set_minuta_client_records_enabled',{p_organization:t.organizationId,p_enabled:true}));
        if(button.dataset.crArchive){
          const row=rows.find(e=>e.id===button.dataset.crArchive);
          if(row?.can_delete && global.confirm('Убрать материал из карточки? Он останется в закрытом архиве организации.'))
            void mutate(()=>rpc('archive_minuta_client_record',{p_id:row.id}));
        }
      });
    }
    function setView(value) {
      currentView = ['history','notes','files'].includes(value) ? value : 'history';
      if (!host) return;
      host.dataset.crView = currentView;
      host.querySelectorAll('[data-cr-view]').forEach(view=>{ view.hidden = view.dataset.crView !== currentView; });
    }
    function reset(){generation++;client=null;rows=[];remote=null;pending=null;loading=false;busy=false;more=false;offset=0;historyLimit=8;errorText='';currentView='history';if(host){host.replaceChildren();host.hidden=true;}}
    return {bind,reset,setView,
      setOrganization(value){
        if(organization?.id===value?.id){organization=value;return;}
        reset();organization=value;
      },
      setClient(value){
        if(!host)return;
        if(client?.phone===value.phone){client=value;render();return;}
        const requestedView=document.querySelector('#clientProfileContent')?.dataset.clientProfileSection;
        reset();client=value;currentView=['history','notes','files'].includes(requestedView)?requestedView:'history';host.hidden=false;
        render();void load();
      }
    };
  }
  global.MinutaClientRecords={createController,prepareFile};
})(window);
