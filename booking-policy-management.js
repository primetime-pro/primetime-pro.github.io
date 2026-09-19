(function () {
  'use strict';

  const depositLabels={none:'Без предоплаты',fixed:'Фиксированная',percent:'Процент'};
  const refundLabels={always_full:'Возврат всегда',full_before_cutoff:'Возврат до срока отмены',nonrefundable:'Без автоматического возврата'};

  function createController(options) {
    const {db,escapeHtml,notify,requireWrites,getCurrentUser,getSessionGeneration,sessionIsCurrent,applyWriteAvailability}=options;
    const select=typeof options.$==='function'?options.$:selector=>document.querySelector(selector);
    function $(selector){return select(selector);}
    let organization=null,payload=null,availability=null,revision=0,writing=false,pendingOrganization;

    function unsupported(error){return /PGRST202|42883|get_minuta_booking_policy_workspace|function .* does not exist/i.test(`${error?.code||''} ${error?.message||''} ${error?.details||''}`);}
    function scopeMatches(data,id){return Boolean(data&&String(data.organization_id||'')===String(id));}
    function setLegacyVisible(value){const form=$('[data-legacy-booking-policy]');if(form)form.hidden=!value;const button=$('#bookingPolicyForm button[type="submit"]');if(button)button.textContent=value?'Сохранить действующие правила':'Сохранить автоматизацию';}
    function reset(){revision+=1;organization=null;payload=null;availability=null;writing=false;pendingOrganization=undefined;$('#organizationBookingPolicyPanel').hidden=true;setLegacyVisible(true);}
    function setBusy(value){$('#organizationBookingPolicyPanel')?.querySelectorAll('[data-organization-policy-write]').forEach(control=>{control.disabled=value||(control.id==='organizationBookingPoliciesEnabled'&&payload?.current_role!=='owner');});}
    async function setOrganization(next){
      const normalized=next?.id?{...next}:null;
      if(writing){pendingOrganization=normalized;revision+=1;return {ok:false,optional:true,pending:true};}
      if(!normalized||!['owner','admin'].includes(normalized.current_role)){reset();return {ok:false,optional:true};}
      organization=normalized;pendingOrganization=undefined;return load();
    }
    async function load(){
      const userId=getCurrentUser()?.id,generation=getSessionGeneration(),organizationId=organization?.id,current=++revision;
      if(!userId||!organizationId){reset();return {ok:false,optional:true};}
      availability='loading';payload=null;$('#organizationBookingPolicyPanel').hidden=false;$('#organizationBookingPolicyLoading').hidden=false;$('#organizationBookingPolicyUnavailable').hidden=true;$('#organizationBookingPolicyWorkspace').hidden=true;
      const {data,error}=await db.rpc('get_minuta_booking_policy_workspace',{p_organization:organizationId});
      if(!sessionIsCurrent(userId,generation)||current!==revision||organization?.id!==organizationId)return {ok:false,optional:true,stale:true};
      $('#organizationBookingPolicyLoading').hidden=true;
      if(error){availability=unsupported(error)?'unsupported':'error';if(availability==='unsupported'){$('#organizationBookingPolicyPanel').hidden=true;setLegacyVisible(true);return {ok:false,optional:true,unsupported:true};}$('#organizationBookingPolicyUnavailable').hidden=false;$('#organizationBookingPolicyUnavailableText').textContent='Записи клиентов продолжают работать по уже сохранённым условиям.';setLegacyVisible(true);return {ok:false,optional:true};}
      if(!scopeMatches(data,organizationId)){availability='error';$('#organizationBookingPolicyUnavailable').hidden=false;$('#organizationBookingPolicyUnavailableText').textContent='Сервер вернул правила другой организации. Изменения заблокированы.';setLegacyVisible(true);return {ok:false,optional:true};}
      payload=data;for(const key of ['locations','services','rules','audit'])if(!Array.isArray(payload[key]))payload[key]=[];
      availability='ready';setLegacyVisible(!Boolean(payload.enabled));render();return {ok:true,optional:true};
    }
    function locationName(id){return payload.locations.find(item=>item.id===id)?.name||'Недоступный филиал';}
    function serviceName(id){return payload.services.find(item=>item.id===id)?.name||'Недоступная услуга';}
    function scopeName(rule){if(!rule.location_id&&!rule.service_id)return 'Вся организация';return [rule.location_id?locationName(rule.location_id):'',rule.service_id?serviceName(rule.service_id):''].filter(Boolean).join(' · ');}
    function ruleCard(rule){
      const deposit=rule.deposit_mode==='fixed'?`${Number(rule.deposit_value||0).toLocaleString('ru-RU')} ₽`:rule.deposit_mode==='percent'?`${rule.deposit_value}%`:'не требуется';
      const removable=Boolean(rule.location_id||rule.service_id);
      return `<article class="organization-policy-rule"><div><strong>${escapeHtml(scopeName(rule))}</strong><small>Отмена ${rule.cancel_cutoff_hours} ч · перенос ${rule.reschedule_cutoff_hours} ч · до ${rule.max_reschedules} раз</small><small>Предоплата: ${escapeHtml(deposit)} · ${escapeHtml(refundLabels[rule.refund_policy]||rule.refund_policy)}</small></div><span><button class="secondary-button" type="button" data-policy-edit="${escapeHtml(rule.id)}">Изменить</button>${removable?`<button class="danger-button" type="button" data-policy-delete="${escapeHtml(rule.id)}" data-organization-policy-write>Удалить</button>`:''}</span></article>`;
    }
    function render(){
      if(availability!=='ready'||!payload)return;
      $('#organizationBookingPolicyWorkspace').hidden=false;$('#organizationBookingPolicyUnavailable').hidden=true;
      $('#organizationBookingPoliciesEnabled').checked=Boolean(payload.enabled);$('#organizationBookingPoliciesEnabled').dataset.ownerAuthorized=String(payload.current_role==='owner');$('#organizationBookingPoliciesEnabled').disabled=payload.current_role!=='owner';
      $('#organizationBookingPolicyRules').innerHTML=payload.rules.length?payload.rules.map(ruleCard).join(''):'<div class="provider-empty compact-empty"><strong>Нет правил</strong><small>Создайте правило для всей организации.</small></div>';
      $('#organizationBookingPolicyLocation').innerHTML='<option value="">Все филиалы</option>'+payload.locations.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
      $('#organizationBookingPolicyService').innerHTML='<option value="">Все услуги</option>'+payload.services.map(item=>`<option value="${escapeHtml(item.id)}"${item.available===false?' disabled':''}>${escapeHtml(item.name)}${item.performer_name?` — ${escapeHtml(item.performer_name)}`:''}${item.available===false?' (недоступна)':''}</option>`).join('');
      if(!$('#organizationBookingPolicyRuleId').value)loadRule(payload.rules.find(rule=>!rule.location_id&&!rule.service_id)||null);
      setBusy(false);applyWriteAvailability();
    }
    function loadRule(rule){
      $('#organizationBookingPolicyRuleId').value=rule?.id||'';$('#organizationBookingPolicyLocation').value=rule?.location_id||'';$('#organizationBookingPolicyService').value=rule?.service_id||'';
      $('#organizationCancelCutoffHours').value=String(rule?.cancel_cutoff_hours??12);$('#organizationRescheduleCutoffHours').value=String(rule?.reschedule_cutoff_hours??12);$('#organizationMaxReschedules').value=String(rule?.max_reschedules??2);
      $('#organizationDepositMode').value=rule?.deposit_mode||'none';$('#organizationDepositValue').value=String(rule?.deposit_value||0);$('#organizationPaymentTimeoutMinutes').value=String(rule?.payment_timeout_minutes??30);$('#organizationAutoCancelUnpaid').checked=Boolean(rule?.auto_cancel_unpaid);$('#organizationRefundPolicy').value=rule?.refund_policy||'full_before_cutoff';$('#organizationPaymentUrlTemplate').value=rule?.payment_url_template||'';updateDepositFields();
    }
    function updateScope(){const location=$('#organizationBookingPolicyLocation').value||null,service=$('#organizationBookingPolicyService').value||null;const existing=payload?.rules.find(rule=>(rule.location_id||null)===location&&(rule.service_id||null)===service);if(existing)loadRule(existing);else{$('#organizationBookingPolicyRuleId').value='';}}
    function updateDepositFields(){const mode=$('#organizationDepositMode').value,enabled=mode!=='none';$('#organizationDepositSettings').hidden=!enabled;$('#organizationDepositValue').disabled=!enabled;$('#organizationDepositValueLabel').textContent=mode==='percent'?'Процент от стоимости, %':'Сумма предоплаты, ₽';$('#organizationDepositValue').max=mode==='percent'?'100':'1000000';if(!enabled)$('#organizationDepositValue').value='0';}
    function errorMessage(error){const text=`${error?.message||''} ${error?.details||''}`;if(text.includes('scope_mismatch'))return 'Филиал или услуга относятся к другой организации.';if(text.includes('invalid_booking_policy_rule'))return 'Проверьте значения правила и безопасную платёжную ссылку.';if(text.includes('owner_required'))return 'Включить модуль может только владелец.';return 'Правило не сохранено. Действующие записи не изменены.';}
    async function mutate(name,args,button,success){
      if(!requireWrites()||writing||availability!=='ready'||!scopeMatches(payload,organization?.id))return false;
      const userId=getCurrentUser()?.id,generation=getSessionGeneration(),organizationId=organization.id,current=++revision;writing=true;setBusy(true);const old=button?.textContent;if(button){button.disabled=true;button.textContent='Сохраняем…';}
      const {data,error}=await db.rpc(name,args);if(button)button.textContent=old;const stale=!sessionIsCurrent(userId,generation)||current!==revision||organization?.id!==organizationId;writing=false;
      if(stale){const next=pendingOrganization;pendingOrganization=undefined;if(next!==undefined)await setOrganization(next);return false;}
      if(error){const holder=$('#organizationBookingPolicyError');holder.textContent=errorMessage(error);holder.hidden=false;await load();return false;}
      if(!scopeMatches(data,organizationId)){notify('Ответ другой организации заблокирован.');await load();return false;}
      $('#organizationBookingPolicyError').hidden=true;notify(success);await load();return true;
    }
    async function saveRule(event){event.preventDefault();const mode=$('#organizationDepositMode').value;const value=mode==='none'?0:Math.round(Number($('#organizationDepositValue').value)||0);await mutate('upsert_minuta_booking_policy_rule',{p_organization:organization.id,p_rule:$('#organizationBookingPolicyRuleId').value||null,p_location:$('#organizationBookingPolicyLocation').value||null,p_service:$('#organizationBookingPolicyService').value||null,p_cancel_cutoff_hours:Math.round(Number($('#organizationCancelCutoffHours').value)),p_reschedule_cutoff_hours:Math.round(Number($('#organizationRescheduleCutoffHours').value)),p_max_reschedules:Math.round(Number($('#organizationMaxReschedules').value)),p_deposit_mode:mode,p_deposit_value:value,p_payment_timeout_minutes:Math.round(Number($('#organizationPaymentTimeoutMinutes').value)||30),p_auto_cancel_unpaid:$('#organizationAutoCancelUnpaid').checked,p_refund_policy:$('#organizationRefundPolicy').value,p_payment_url_template:$('#organizationPaymentUrlTemplate').value.trim()},event.submitter,payload?.enabled?'Правило сохранено':'Правило сохранено. Оно начнёт действовать после включения модуля');}
    async function handleClick(event){const edit=event.target.closest?.('[data-policy-edit]');if(edit){const rule=payload?.rules.find(item=>item.id===edit.dataset.policyEdit);if(rule){loadRule(rule);$('#organizationBookingPolicyEditor').open=true;}return;}const remove=event.target.closest?.('[data-policy-delete]');if(remove&&confirm('Удалить это правило? Будет применяться менее точное правило.'))await mutate('delete_minuta_booking_policy_rule',{p_organization:organization.id,p_rule:remove.dataset.policyDelete},remove,'Правило удалено');}
    function bind(){
      $('#organizationBookingPolicyForm')?.addEventListener('submit',saveRule);$('#organizationBookingPoliciesEnabled')?.addEventListener('change',event=>mutate('set_minuta_booking_policies_enabled',{p_organization:organization.id,p_enabled:event.target.checked},event.target,event.target.checked?'Правила филиалов включены':'Правила филиалов выключены'));
      $('#organizationBookingPolicyLocation')?.addEventListener('change',updateScope);$('#organizationBookingPolicyService')?.addEventListener('change',updateScope);$('#organizationDepositMode')?.addEventListener('change',updateDepositFields);$('#organizationBookingPolicyRules')?.addEventListener('click',handleClick);$('#retryOrganizationBookingPolicy')?.addEventListener('click',load);
    }
    return {bind,setOrganization,load,reset,get payload(){return payload;},get availability(){return availability;}};
  }
  window.MinutaBookingPolicies={createController};
})();
