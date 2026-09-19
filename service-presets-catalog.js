(() => {
  'use strict';

  const catalog = {
    version: 1,
    locale: 'ru-RU',
    evidence: 'cross_platform_public_catalog',
    ranking: 'editorial_v1',
    professions: [
      {
        id: 'massage_therapist', label: 'Массажист', shortLabel: 'Массаж',
        services: [
          ['massage_full_body', 'Массаж всего тела', 60, 'Массаж'],
          ['massage_back_neck_shoulders', 'Массаж спины, шеи и плеч', 45, 'Массаж'],
          ['massage_relaxing', 'Расслабляющий массаж', 60, 'Массаж'],
          ['massage_sports', 'Спортивный массаж', 60, 'Массаж'],
          ['massage_lymphatic', 'Лимфодренажный массаж', 60, 'Массаж'],
          ['massage_face', 'Массаж лица', 30, 'Массаж'],
          ['massage_head', 'Массаж головы', 30, 'Массаж']
        ]
      },
      {
        id: 'nail_artist', label: 'Ногтевой мастер', shortLabel: 'Ногти',
        services: [
          ['nails_manicure_basic', 'Маникюр без покрытия', 60, 'Маникюр'],
          ['nails_manicure_gel', 'Маникюр с покрытием', 120, 'Маникюр'],
          ['nails_removal', 'Снятие покрытия', 30, 'Маникюр'],
          ['nails_strengthening', 'Укрепление ногтей', 30, 'Маникюр'],
          ['nails_extension', 'Наращивание ногтей', 180, 'Маникюр'],
          ['nails_extension_correction', 'Коррекция наращивания', 120, 'Маникюр'],
          ['nails_pedicure', 'Педикюр', 90, 'Педикюр']
        ]
      },
      {
        id: 'hair_stylist', label: 'Парикмахер / колорист', shortLabel: 'Волосы',
        services: [
          ['hair_womens_cut', 'Женская стрижка', 60, 'Стрижки'],
          ['hair_mens_cut', 'Мужская стрижка', 45, 'Стрижки'],
          ['hair_styling', 'Укладка', 60, 'Укладка'],
          ['hair_coloring', 'Окрашивание', 180, 'Окрашивание'],
          ['hair_root_coloring', 'Окрашивание корней', 120, 'Окрашивание'],
          ['hair_care', 'Уход за волосами', 60, 'Уход'],
          ['hair_consultation', 'Консультация', 30, 'Консультация']
        ]
      },
      {
        id: 'barber', label: 'Барбер', shortLabel: 'Барбер',
        services: [
          ['barber_haircut', 'Мужская стрижка', 45, 'Стрижки'],
          ['barber_beard', 'Оформление бороды', 30, 'Борода'],
          ['barber_haircut_beard', 'Стрижка + борода', 75, 'Комплекс'],
          ['barber_kids_cut', 'Детская стрижка', 45, 'Стрижки'],
          ['barber_fade', 'Фейд', 45, 'Стрижки'],
          ['barber_shave', 'Бритьё головы или лица', 45, 'Бритьё'],
          ['barber_gray_blending', 'Камуфляж седины', 45, 'Окрашивание']
        ]
      },
      {
        id: 'brow_artist', label: 'Бровист', shortLabel: 'Брови',
        services: [
          ['brows_shaping', 'Коррекция формы бровей', 30, 'Брови'],
          ['brows_tinting', 'Окрашивание бровей', 30, 'Брови'],
          ['brows_shaping_tinting', 'Коррекция + окрашивание', 45, 'Брови'],
          ['brows_lamination', 'Ламинирование бровей', 60, 'Брови'],
          ['brows_lamination_tinting', 'Ламинирование + окрашивание', 75, 'Брови'],
          ['brows_consultation', 'Консультация', 20, 'Консультация']
        ]
      },
      {
        id: 'lash_artist', label: 'Лэшмейкер', shortLabel: 'Ресницы',
        services: [
          ['lashes_classic', 'Классическое наращивание', 120, 'Наращивание'],
          ['lashes_hybrid', 'Лёгкий объём', 150, 'Наращивание'],
          ['lashes_volume', 'Объёмное наращивание', 180, 'Наращивание'],
          ['lashes_refill', 'Коррекция наращивания', 120, 'Коррекция'],
          ['lashes_removal', 'Снятие ресниц', 30, 'Снятие'],
          ['lashes_lamination', 'Ламинирование ресниц', 75, 'Ламинирование'],
          ['lashes_tinting', 'Окрашивание ресниц', 30, 'Окрашивание']
        ]
      },
      {
        id: 'esthetician', label: 'Косметолог-эстетист', shortLabel: 'Уход за лицом',
        services: [
          ['esthetician_consultation', 'Консультация по уходу', 30, 'Консультация'],
          ['esthetician_basic_facial', 'Базовый уход за лицом', 60, 'Уход'],
          ['esthetician_cleansing_facial', 'Очищающий уход', 75, 'Уход'],
          ['esthetician_surface_peel', 'Поверхностный пилинг', 45, 'Уход'],
          ['esthetician_face_massage', 'Массаж лица', 45, 'Уход'],
          ['esthetician_express_care', 'Экспресс-уход', 30, 'Уход'],
          ['esthetician_back_care', 'Уход за спиной', 60, 'Уход']
        ]
      },
      {
        id: 'makeup_artist', label: 'Визажист', shortLabel: 'Макияж',
        services: [
          ['makeup_natural', 'Естественный макияж', 60, 'Макияж'],
          ['makeup_day', 'Дневной макияж', 60, 'Макияж'],
          ['makeup_evening', 'Вечерний макияж', 90, 'Макияж'],
          ['makeup_event', 'Макияж для события', 90, 'Макияж'],
          ['makeup_bridal', 'Свадебный макияж', 120, 'Свадебный образ'],
          ['makeup_bridal_trial', 'Пробный свадебный макияж', 120, 'Свадебный образ'],
          ['makeup_consultation', 'Консультация', 30, 'Консультация']
        ]
      },
      {
        id: 'depilation_artist', label: 'Мастер депиляции', shortLabel: 'Депиляция',
        services: [
          ['depilation_underarms', 'Депиляция: подмышки', 20, 'Зоны'],
          ['depilation_lower_legs', 'Депиляция: голени', 30, 'Зоны'],
          ['depilation_full_legs', 'Депиляция: ноги полностью', 60, 'Зоны'],
          ['depilation_face_zone', 'Депиляция: зона лица', 20, 'Зоны'],
          ['depilation_bikini', 'Депиляция: бикини', 30, 'Зоны'],
          ['depilation_deep_bikini', 'Депиляция: глубокое бикини', 45, 'Зоны'],
          ['depilation_combo', 'Комплекс зон', 90, 'Комплекс']
        ]
      },
      {
        id: 'tattoo_piercing_artist', label: 'Тату / пирсинг', shortLabel: 'Тату и пирсинг',
        services: [
          ['tattoo_consultation', 'Консультация по тату', 30, 'Тату'],
          ['tattoo_session', 'Сеанс татуировки', 180, 'Тату'],
          ['tattoo_correction', 'Коррекция татуировки', 90, 'Тату'],
          ['piercing_consultation', 'Консультация по пирсингу', 20, 'Пирсинг'],
          ['piercing_ear', 'Пирсинг уха', 30, 'Пирсинг'],
          ['piercing_body', 'Пирсинг тела', 30, 'Пирсинг'],
          ['piercing_jewelry_change', 'Замена украшения', 20, 'Пирсинг']
        ]
      },
      {
        id: 'spa_body_care', label: 'SPA / уход за телом', shortLabel: 'SPA',
        services: [
          ['spa_body_care', 'Уход за телом', 60, 'Уход за телом'],
          ['spa_body_scrub', 'Скрабирование тела', 45, 'Уход за телом'],
          ['spa_body_wrap', 'Обёртывание', 60, 'Уход за телом'],
          ['spa_program', 'SPA-программа', 120, 'Программы'],
          ['spa_scrub_massage', 'Скрабирование + массаж', 90, 'Программы'],
          ['spa_foot_care', 'SPA-уход для ног', 45, 'Уход за телом'],
          ['spa_back_care', 'Уход за спиной', 60, 'Уход за телом']
        ]
      },
      {
        id: 'fitness_yoga_coach', label: 'Тренер / фитнес / йога', shortLabel: 'Фитнес и йога',
        services: [
          ['fitness_personal', 'Индивидуальная тренировка', 60, 'Фитнес'],
          ['fitness_group', 'Групповая тренировка', 60, 'Фитнес'],
          ['fitness_intro', 'Вводная тренировка', 45, 'Фитнес'],
          ['yoga_personal', 'Индивидуальная йога', 60, 'Йога'],
          ['yoga_group', 'Групповая йога', 60, 'Йога'],
          ['fitness_mobility', 'Растяжка и мобильность', 60, 'Практики'],
          ['fitness_consultation', 'Консультация', 30, 'Консультация']
        ]
      }
    ]
  };

  catalog.professions = catalog.professions.map(profession => Object.freeze({
    ...profession,
    services: Object.freeze(profession.services.map(([id, name, defaultDuration, category], rank) => Object.freeze({
      id, professionId: profession.id, name, defaultDuration, category, rank
    })))
  }));

  const professionsById = new Map(catalog.professions.map(item => [item.id, item]));
  const presetsById = new Map(catalog.professions.flatMap(item => item.services).map(item => [item.id, item]));
  const normalizeName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase(catalog.locale);
  const profession = id => professionsById.get(String(id || '')) || null;
  const preset = id => presetsById.get(String(id || '')) || null;
  const servicesFor = ids => [...new Set((Array.isArray(ids) ? ids : []).map(String))].flatMap(id => profession(id)?.services || []);
  const search = (query, ids) => {
    const needle = normalizeName(query);
    const source = ids?.length ? servicesFor(ids) : [...presetsById.values()];
    return needle ? source.filter(item => normalizeName(`${item.name} ${item.category}`).includes(needle)) : source;
  };

  window.MinutaServicePresetCatalog = Object.freeze({
    ...catalog,
    professions: Object.freeze(catalog.professions),
    profession,
    preset,
    servicesFor,
    search,
    normalizeName
  });
})();
