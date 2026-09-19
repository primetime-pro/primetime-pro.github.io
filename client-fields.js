(function initMinutaClientFields(global) {
  'use strict';

  function requestId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    throw new Error('secure_request_id_unavailable');
  }

  function createClientFieldsController(options = {}) {
    const db = options.db;
    const organizationId = options.organizationId;
    const notify = options.notify || (() => {});
    let available = true;

    if (!db || !organizationId) throw new Error('client_fields_configuration_required');

    async function rpc(name, payload) {
      const result = await db.rpc(name, payload);
      if (result.error) {
        if (/function .* does not exist|schema cache/i.test(result.error.message || '')) available = false;
        throw result.error;
      }
      return result.data;
    }

    return {
      get available() { return available; },
      async loadConfiguration() {
        if (!available) return { enabled:false,definitions:[],values:[],optional:true };
        try {
          return await rpc('get_minuta_client_field_workspace', {
            p_organization:organizationId,p_client_phone:null
          });
        } catch (error) {
          if (!available) return { enabled:false,definitions:[],values:[],optional:true };
          throw error;
        }
      },
      async load(clientPhone) {
        if (!available || !clientPhone) return { enabled:false,definitions:[],values:[],optional:true };
        try {
          return await rpc('get_minuta_client_field_workspace', {
            p_organization:organizationId,
            p_client_phone:clientPhone
          });
        } catch (error) {
          if (!available) return { enabled:false,definitions:[],values:[],optional:true };
          throw error;
        }
      },
      async setEnabled(enabled) {
        const data = await rpc('set_minuta_client_fields_enabled', {
          p_organization:organizationId,p_enabled:enabled === true,p_request_id:requestId()
        });
        notify(enabled ? 'Дополнительные поля включены' : 'Дополнительные поля выключены');
        return data;
      },
      async saveDefinition(definition) {
        const id = definition.id || requestId();
        return rpc('save_minuta_client_field_definition', {
          p_organization:organizationId,p_definition:id,p_field_key:definition.fieldKey,
          p_label:definition.label,p_field_type:definition.fieldType,p_options:definition.options || [],
          p_required:definition.required === true,p_active:definition.active !== false,
          p_sort_order:Number.isInteger(definition.sortOrder) ? definition.sortOrder : 0,
          p_request_id:requestId()
        });
      },
      async saveValue(definitionId, clientPhone, value) {
        return rpc('set_minuta_client_field_value', {
          p_organization:organizationId,p_definition:definitionId,p_client_phone:clientPhone,
          p_value:value,p_request_id:requestId()
        });
      },
      async clearValue(definitionId, clientPhone) {
        return rpc('delete_minuta_client_field_value', {
          p_organization:organizationId,p_definition:definitionId,p_client_phone:clientPhone,
          p_request_id:requestId()
        });
      }
    };
  }

  function createClientFieldsUIController(options = {}) {
    const $ = options.$ || ((selector) => document.querySelector(selector));
    const escapeHtml = options.escapeHtml || ((value) => String(value ?? ''));
    const notify = options.notify || (() => {});
    const requireWrites = options.requireWrites || (() => true);
    let organization = null;
    let api = null;
    let workspace = null;
    let selectedPhone = '';
    let bound = false;
    let definitionEditorOpen = false;

    function isManager() {
      return ['owner', 'admin'].includes(String(workspace?.current_role || organization?.current_role || ''));
    }

    function valueByDefinition(id) {
      return workspace?.values?.find((item) => String(item.definition_id) === String(id))?.value;
    }

    function fieldMarkup(definition) {
      const value = valueByDefinition(definition.id);
      const common = `data-client-field-value="${escapeHtml(definition.id)}"`;
      if (definition.field_type === 'textarea') return `<textarea ${common} rows="3" maxlength="2000">${escapeHtml(value ?? '')}</textarea>`;
      if (definition.field_type === 'boolean') return `<input ${common} type="checkbox" ${value === true ? 'checked' : ''}>`;
      if (definition.field_type === 'select') {
        const choices = Array.isArray(definition.options) ? definition.options : [];
        return `<select ${common}><option value="">Не выбрано</option>${choices.map((item) => `<option value="${escapeHtml(item)}" ${String(value ?? '') === String(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select>`;
      }
      const type = definition.field_type === 'number' ? 'number' : definition.field_type === 'date' ? 'date' : 'text';
      const limit = type === 'text' ? ' maxlength="200"' : '';
      return `<input ${common} type="${type}"${limit} value="${escapeHtml(value ?? '')}">`;
    }

    function render() {
      const settings = $('#clientFieldsSettings');
      const values = $('#clientCustomFields');
      if (!settings || !values) return;
      const enabled = Boolean(workspace?.enabled);
      const definitions = Array.isArray(workspace?.definitions) ? workspace.definitions : [];
      const activeDefinitions = definitions.filter((item) => item.active);
      settings.hidden = !organization || !api?.available || !isManager();
      values.hidden = !organization || !api?.available || !enabled || !selectedPhone || !activeDefinitions.length;
      if ($('#clientFieldsEnabled')) $('#clientFieldsEnabled').checked = enabled;
      const list = $('#clientFieldDefinitionsList');
      if (list) list.innerHTML = definitions.length
        ? definitions.map((item) => `<article><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.field_key)} · ${escapeHtml(item.field_type)}${item.required ? ' · обязательно' : ''}${item.active ? '' : ' · выключено'}</small></div></article>`).join('')
        : '<div class="client-fields-empty"><strong>Полей пока нет</strong><small>Добавьте только действительно нужные сведения.</small></div>';
      const count = $('#clientFieldDefinitionsCount');
      if (count) count.textContent = definitions.length ? `${definitions.length} ${definitions.length === 1 ? 'поле' : definitions.length < 5 ? 'поля' : 'полей'}` : 'Пока нет';
      const definitionForm = $('#clientFieldDefinitionForm');
      if (definitionForm) definitionForm.hidden = !definitionEditorOpen;
      const addButton = $('#showClientFieldForm');
      if (addButton) addButton.hidden = definitionEditorOpen;
      const form = $('#clientCustomFieldsForm');
      if (form) {
        form.innerHTML = activeDefinitions.length
          ? `${activeDefinitions.map((item) => `<label><span>${escapeHtml(item.label)}${item.required ? ' *' : ''}</span>${fieldMarkup(item)}</label>`).join('')}<p class="form-error" id="clientCustomFieldsError" hidden></p><button class="secondary-button" type="submit">Сохранить дополнительные данные</button>`
          : '';
      }
      global.refreshSectionNavigation?.();
    }

    async function loadConfiguration() {
      if (!api) return;
      workspace = await api.loadConfiguration();
      render();
    }

    async function setOrganization(next) {
      organization = next?.id ? next : null;
      api = organization ? createClientFieldsController({ db:options.db, organizationId:organization.id, notify }) : null;
      workspace = null;
      selectedPhone = '';
      if (!api) { render(); return; }
      try { await loadConfiguration(); }
      catch { render(); }
    }

    async function setClient(phone) {
      selectedPhone = String(phone || '');
      if (!api || !selectedPhone) { render(); return; }
      try { workspace = await api.load(selectedPhone); }
      catch { /* Optional layer stays hidden when unavailable. */ }
      render();
    }

    function readValue(definition, input) {
      if (definition.field_type === 'boolean') return input.checked;
      if (definition.field_type === 'number') return input.value === '' ? null : Number(input.value);
      return input.value.trim();
    }

    async function handleChange(event) {
      if (event.target.id === 'clientFieldType') {
        const optionsField = $('#clientFieldOptionsField');
        if (optionsField) optionsField.hidden = event.target.value !== 'select';
        return;
      }
      if (event.target.id !== 'clientFieldsEnabled' || !api || !requireWrites()) return;
      event.target.disabled = true;
      try { await api.setEnabled(event.target.checked); workspace = await api.loadConfiguration(); }
      catch { event.target.checked = !event.target.checked; notify('Не удалось изменить дополнительные поля'); }
      finally { event.target.disabled = false; render(); }
    }

    async function handleSubmit(event) {
      if (event.target.id === 'clientFieldDefinitionForm') {
        event.preventDefault();
        if (!api || !requireWrites()) return;
        const type = $('#clientFieldType').value;
        const optionsList = type === 'select' ? $('#clientFieldOptions').value.split(',').map((item) => item.trim()).filter(Boolean) : [];
        try {
          await api.saveDefinition({
            fieldKey:$('#clientFieldKey').value.trim().toLowerCase(), label:$('#clientFieldLabel').value.trim(),
            fieldType:type, options:optionsList, required:$('#clientFieldRequired').checked,
            sortOrder:Number($('#clientFieldSort').value || 0)
          });
          event.target.reset();
          definitionEditorOpen = false;
          await loadConfiguration();
          notify('Поле клиента сохранено');
        } catch { notify('Не удалось сохранить поле клиента'); }
        return;
      }
      if (event.target.id !== 'clientCustomFieldsForm') return;
      event.preventDefault();
      if (!api || !selectedPhone || !requireWrites()) return;
      const definitions = (workspace?.definitions || []).filter((item) => item.active);
      const error = $('#clientCustomFieldsError');
      if (error) error.hidden = true;
      try {
        for (const definition of definitions) {
          const input = event.target.querySelector(`[data-client-field-value="${CSS.escape(String(definition.id))}"]`);
          if (!input) continue;
          const value = readValue(definition, input);
          const empty = value === null || value === '';
          if (empty && definition.required) throw new Error('required');
          if (empty) await api.clearValue(definition.id, selectedPhone);
          else await api.saveValue(definition.id, selectedPhone, value);
        }
        workspace = await api.load(selectedPhone);
        render();
        notify('Дополнительные данные сохранены');
      } catch {
        if (error) { error.textContent = 'Заполните обязательные поля и проверьте значения.'; error.hidden = false; }
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      document.addEventListener('change', handleChange);
      document.addEventListener('submit', handleSubmit);
      document.addEventListener('click', (event) => {
        if (event.target.closest('#showClientFieldForm')) {
          definitionEditorOpen = true;
          render();
          $('#clientFieldLabel')?.focus();
        }
        if (event.target.closest('#cancelClientFieldForm')) {
          definitionEditorOpen = false;
          $('#clientFieldDefinitionForm')?.reset();
          const optionsField = $('#clientFieldOptionsField');
          if (optionsField) optionsField.hidden = true;
          render();
        }
      });
    }

    return { bind, setOrganization, setClient, loadConfiguration, render };
  }

  global.createMinutaClientFieldsController = createClientFieldsController;
  global.createMinutaClientFieldsUIController = createClientFieldsUIController;
})(window);
