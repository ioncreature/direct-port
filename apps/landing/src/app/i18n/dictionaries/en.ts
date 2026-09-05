import type { Dictionary } from './ru';

export const en: Dictionary = {
  meta: {
    title: 'DirectPort — customs costs for an entire container in 10 minutes',
    description:
      'Customs duties, VAT, and excise across your whole price list in 10 minutes — up to 500 line items in a single file. Built for logistics companies and importers. $1 per line item, first 50 free. HS codes from the official FTS tariff database, plus a draft declaration and a shipment document checklist.',
    ogDescription:
      'Customs cost calculation for a full container in 10 minutes. Up to 500 line items per file, $1 per line item (first 50 free), HS codes from the official FTS tariff database.',
    ogSubtitle:
      'Send us your price list — get an Excel with duties, VAT, excise, a draft declaration, and a document checklist for every line item.',
    ogPills: ['$1 per line item', 'FTS tariff database', 'CBR exchange rates', 'ru · zh · en'],
  },

  langSwitch: {
    label: 'Interface language',
  },

  nav: {
    ariaLabel: 'Main navigation',
    how: 'How it works',
    deliver: 'What you get',
    pricing: 'Pricing',
    calc: 'Calculator',
    compare: 'Comparison',
  },

  header: {
    emailLabel: 'Email us',
    telegramLabel: 'Message a manager on Telegram',
    phoneLabel: 'Call',
  },

  hero: {
    tagline: 'Customs cost calculation for logistics companies',
    headlinePrimary: 'A whole container in 10 minutes,',
    headlineAccent: 'not a week',
    lede: 'A broker handles one line item in an hour or two, but a container with dozens of different goods drags on for weeks. We calculate duties, VAT, excise, and logistics across your entire price list in 10 minutes — whether it’s 10 line items or 500. Take on the consolidated cargo others won’t touch, and give your client an exact quote the same day.',
    ctaTelegram: 'Send your price list on Telegram',
    ctaNote: 'Your first 50 line items are free',
    trust: [
      '10 minutes for the whole price list',
      '$1 per line item',
      'up to 500 line items per file',
      'HS codes from the FTS tariff database',
    ],
    terminal: {
      fileName: 'duty-calc.xlsx',
      rows: [
        { code: '9405 41', desc: 'LED lamp, 12W', rate: '5%', sum: '119,400 ₽', warn: false },
        { code: '6911 10', desc: 'Ceramic mug', rate: '12%', sum: '56,600 ₽', warn: false },
        { code: '6403 99', desc: 'Running shoes', rate: '15%/1.4€', sum: '482,100 ₽', warn: true },
        { code: '3304 99', desc: 'Facial cosmetics', rate: '6.5%', sum: '208,750 ₽', warn: false },
      ],
      okLabel: 'ok',
      checkLabel: 'chk',
      totalLabel: 'total',
      totalDesc: '4 line items · 10 min',
      totalSum: '866,850 ₽',
    },
  },

  miniCalc: {
    label: 'Mini calculator',
    page: {
      metaTitle: 'Online customs duty calculator: TN VED code, duty, VAT — DirectPort',
      metaDescription:
        'Free customs payments estimate for one product: TN VED code from the FCS tariff database, duty, VAT and excise in rubles at the CBR exchange rate. Online, no sign-up.',
      heading: 'Customs payments calculator',
      intro:
        'Enter a product and its value — get the TN VED code, rates and an estimate of customs payments in rubles. Free, no sign-up.',
      points: [
        'Codes and rates come from the official FCS tariff database',
        'Conversion at the current CBR exchange rate',
        'Combined rates: both percentage and euros per kilogram or pair',
      ],
    },
    teaser: {
      heading: 'Estimate duties for one product right now',
      text: 'A free mini calculator: enter a product and its value — get the TN VED code, rates and an estimate of customs payments in rubles at the CBR exchange rate.',
      cta: 'Open the calculator',
      note: 'Free, no sign-up',
    },
    form: {
      queryLabel: 'Product or TN VED code',
      queryPlaceholder: 'e.g.: running shoes — or 6403 99',
      priceLabel: 'Shipment value',
      weightLabel: 'Net weight, kg',
      quantityLabel: 'Quantity, pcs',
      optionalHint: 'weight and quantity are needed for per-kg and per-unit/per-pair rates',
      submit: 'Calculate',
      calculating: 'Calculating…',
    },
    result: {
      codeLabel: 'TN VED code',
      searchedAs: 'searched as',
      goodsLabel: 'Goods value',
      dutyLabel: 'Duty',
      exciseLabel: 'Excise',
      vatLabel: 'VAT',
      paymentsLabel: 'Customs payments',
      totalLabel: 'Total incl. goods',
      exchangeRateLabel: 'CBR exchange rate',
      estimateBadge: 'preliminary estimate',
      alternativesLabel: 'Not your product? Try the neighbouring codes:',
    },
    errors: {
      byCode: {
        CALC_NOTHING_FOUND: 'Nothing found — refine the product description or enter a TN VED code.',
        CALC_RATE_LIMITED:
          'Request limit reached for today. Unlimited calculation is available in Telegram.',
      },
      generic: 'Calculation failed — please try again a bit later.',
    },
    disclaimer:
      'Preliminary estimate based on the FCS tariff database and CBR exchange rate — country of origin, freight and special rates are not applied. Not an offer.',
    cta: {
      text: 'A whole container is calculated the same way — up to 500 line items in 10 minutes.',
      highlight: 'First 50 line items are free.',
      button: 'Calculate the full price list in Telegram',
    },
  },

  pain: {
    label: 'Sound familiar?',
    heading: 'The wider the product range, the more expensive and slower the paperwork',
    intro:
      'Past a certain volume, manual processing stops paying off, and it’s easier to turn a request away than spend weeks on it. That’s the ceiling small logistics companies keep hitting.',
    items: [
      {
        title: 'Dozens of SKUs in one container',
        text: 'Consolidated cargo isn’t a single product — it’s dozens of different line items. Each needs its own HS code and its own calculation.',
      },
      {
        title: 'An hour or two per line item',
        text: 'The broker manually picks a code, checks the rates, and calculates duty, VAT, and excise for every row of the price list.',
      },
      {
        title: 'Weeks of work — and rejections',
        text: 'A hundred line items stretch into days and weeks. Few will take on cargo like that, and clients move to whoever can keep up.',
      },
    ],
    resolve:
      'DirectPort lifts that ceiling: the number of line items no longer runs into person-hours — the whole price list is calculated in 10 minutes, whether it holds 10 rows or 500.',
  },

  audience: {
    label: 'Who this is for',
    heading: 'When the range is wide and the deadline was yesterday',
    intro:
      'The task is the same for everyone: find out what importing the whole range will cost, without collecting codes one by one. Only the reason you need the numbers changes.',
    items: [
      {
        title: 'Marketplace sellers',
        text: 'Moving from grey shipping to fully declared imports: marketplaces ask for a customs declaration, and you cannot file one without HS codes. Get codes, payments, and the document list for your entire catalogue at once — including national labelling requirements.',
      },
      {
        title: 'Freight forwarders and door-to-door services',
        text: 'Your client wants a quote today. Cost out their whole price list in 10 minutes and answer with numbers while competitors are still picking codes by hand. Take on the mixed consignments you used to turn down.',
      },
      {
        title: 'Importers and foreign trade teams',
        text: 'Landed cost before you ship: duties, VAT, excise, recycling fees, and regulatory requirements across the full range — before the money leaves for the supplier.',
      },
      {
        title: 'Brokers and declarants',
        text: 'The goods section arrives ready: a draft declaration with boxes 31–47 and an export file for Kontur.Declarant, Alta, and CTM. Not a replacement for your work — it removes the grind from multi-line shipments.',
      },
    ],
  },

  how: {
    label: 'How it works',
    heading: 'From a Telegram message to a finished calculation',
    intro:
      'No dashboards, no learning curve. A manager guides you through the whole process — from file to result.',
    steps: [
      {
        title: 'Message the bot on Telegram',
        text: 'Open the bot — a manager answers. Tell us what the cargo is, no sign-ups and no software to install.',
      },
      {
        title: 'Send your price list',
        text: 'Excel or CSV in any language and any currency. The manager tops up your balance — $1 per line item. We only charge for rows we successfully process.',
      },
      {
        title: 'We calculate the whole price list',
        text: 'AI matches HS codes against the FTS tariff database, interprets the rates, and calculates duties, VAT, excise, and logistics for every row.',
      },
      {
        title: 'A ready Excel in 10 minutes',
        text: 'The manager sends you the file: code, rates, and total for each line item — in the original currency and in rubles, with regulatory requirements.',
      },
    ],
  },

  deliver: {
    label: 'What you get',
    heading: 'Not just an estimate — a head start on the declaration',
    intro:
      'The result is a single Excel workbook with three sheets, plus an export file for declaration software. From landed-cost estimate to filing — without retyping the data.',
    items: [
      {
        tag: 'Sheet 1',
        title: '“Result” — a calculation for every row',
        text: 'HS code, rates, duty, VAT, excise, and the total for each line item — in the contract currency and in rubles. Borderline codes are color-flagged, and product photos from your file sit next to the rows.',
      },
      {
        tag: 'Sheet 2',
        title: '“Draft declaration” — the groundwork',
        text: 'Line items are grouped into declaration goods: boxes 31–47, customs value, unit value per kg, and the customs processing fee. Your declarant doesn’t start from scratch.',
      },
      {
        tag: 'Sheet 3',
        title: '“Shipment documents” — a checklist',
        text: 'Which documents to collect and when: before ordering, at shipping, at filing. With box 44 codes and the legal basis for each item.',
      },
      {
        tag: '+ file',
        title: 'Export for declaration software',
        text: 'The goods section as a separate file that Kontur.Declarant, Alta, and STM import directly — no retyping rows by hand.',
      },
    ],
    catalogNote:
      'Shipping the same goods again and again? Confirmed codes are saved to your catalog: repeat shipments reuse them automatically — faster, and with no drift between calculations.',
  },

  report: {
    label: 'Sample report',
    heading: 'This is what you get — from a real shipment',
    intro:
      'Below are fragments of an actual calculation: a mixed consignment of bathroom fittings from China, 13 price-list rows, 5 declaration goods items. The figures are real, flagged uncertain lines included.',
    sheets: [
      {
        tag: 'Sheet 1',
        title: 'Results',
        note: 'Every price-list row → code, rates, and total. Uncertain codes are flagged.',
        columns: ['Product', 'Qty', 'HS code', 'Duty', 'Total, ₽', 'Status'],
        rows: [
          ['Shower rail holder, S-HT02A', '3,000', '3926909709', '6.5%', '596,168', 'ok'],
          ['Shower rail soap dish, S12-', '300', '3924900009', '6.5%', '27,051', 'ok'],
          ['Hygienic shower head, GD-500', '34,200', '3922900000', '6.5%', '1,127,154', 'ok'],
          ['Flexible tap hose, GB', '3,360', '7326909807', '7.5%', '3,040,761', 'warn'],
          ['Car headrest hanger, YJ-03', '480', '8302500000', '12%', '177,655', 'warn'],
        ],
      },
      {
        tag: 'Sheet 2',
        title: 'Draft declaration',
        note: 'Rows grouped into declaration goods items, in customs box terms.',
        columns: [
          '#',
          'Code (box 33)',
          'Net (box 38)',
          'Customs value (box 45), ₽',
          'Duty (box 47), ₽',
          'VAT (box 47), ₽',
          'Unit value, $/kg',
        ],
        rows: [
          ['1', '3926909709', '180.24', '550,605', '35,789', '129,007', '39.03'],
          ['2', '3924900009', '7.20', '20,819', '1,353', '4,878', '36.95'],
          ['3', '3922900000', '700.96', '1,736,792', '112,891', '406,931', '31.66'],
          ['4', '7326909807', '495.94', '2,980,976', '223,573', '705,000', '76.80'],
          ['5', '8302500000', '42,679.98', '465,893', '55,908', '114,796', '0.14'],
        ],
      },
      {
        tag: 'Sheet 3',
        title: 'Shipment documents',
        note: 'What to collect and when — with box 44 document codes.',
        columns: ['Document', 'Box 44', 'Status', 'When to obtain'],
        rows: [
          ['Foreign trade contract with specifications', '03011', 'Required', 'Before ordering'],
          ['State registration certificate (SGR)', '01206/01411', 'Required', 'Before ordering'],
          ['Declaration of conformity TR EAEU 043/2017', '01402', 'Required', 'Before shipping'],
          ['National product labelling', '—', 'Required', 'Before shipping'],
          ['Export declaration from country of departure', '—', 'Likely required', 'Before shipping'],
          ['Recycling fee calculation', '10064', 'Check', 'At filing'],
        ],
      },
    ],
    statusLabels: { ok: 'Exact', warn: 'Check' },
    totals: {
      label: 'Shipment totals',
      items: [
        { name: 'Customs value', value: '5,755,086 ₽' },
        { name: 'Customs processing fee', value: '49,240 ₽' },
        { name: 'Customs value declaration', value: 'required' },
      ],
    },
    footer:
      'The full file has 24 columns on the results sheet, a 44-row document checklist with legal grounds for each item, and a separate goods export file for declaration software.',
    cta: 'Cost out your price list',
  },

  pricing: {
    label: 'Pricing',
    priceMain: '$1',
    priceUnit: ' per line item.',
    intro:
      'No subscriptions, no monthly fees. Pay only for the line items you process — the rate and your balance are visible upfront, and the more you run, the lower the per-item price.',
    unit: 'line items',
    tiers: [
      { count: 'First 50', price: 'Free', sub: 'check the quality before you pay', discount: '', free: true },
      { count: '100', price: '$100', sub: '$1 per line item', discount: '', free: false },
      { count: '500', price: '$450', sub: '$0.90 per line item', discount: '−10%', free: false },
      { count: '5,000', price: '$4,000', sub: '$0.80 per line item', discount: '−20%', free: false },
    ],
    note: 'Top up your balance through a manager — we only charge for line items we successfully process',
    guaranteeLine:
      'If we get a code or rate wrong, we recalculate for free and give you 50% off your next 100 line items',
    includes: [
      'HS code matched and checked against the FTS tariff database',
      'Duty, VAT, and excise for every line item',
      'Currency conversion at the CBR exchange rate',
      'Freight to the border included in the customs value',
      'Logistics based on your own delivery formula',
      'Regulatory requirements: certification, labeling, recycling fee',
      '“Draft declaration” sheet: boxes 31–47 for your declarant',
      '“Shipment documents” checklist with box 44 codes',
      'Export for declaration software: Kontur.Declarant, Alta, STM',
    ],
    footnote: '* Prices are in US dollars. Payment in rubles at the CBR exchange rate on the day of payment.',
  },

  compare: {
    label: 'Comparison',
    heading: 'How this differs from a calculator and from a broker',
    intro:
      'Existing tools each cover part of the job: a calculator computes payments for a code you already know; AI services suggest a code for one product; declaration software fills in the form. None of them takes the whole price list.',
    columns: ['Mini calculators', 'AI code lookup', 'Declaration software', 'DirectPort'],
    rows: [
      { label: 'Line items at once', values: ['1', '1', 'entered by hand', 'up to 500 from a file'] },
      { label: 'Finds the HS code', values: ['no', 'yes', 'no', 'yes, with verification'] },
      {
        label: 'Regulatory documents',
        values: ['no', 'partly', 'reference only', 'checklist by stage'],
      },
      {
        label: 'Draft declaration and software export',
        values: ['no', 'no', 'you fill it in', 'included'],
      },
    ],
    cta: 'Detailed comparison',
    note: 'Based on public websites and price lists as of 5 September 2026.',
  },

  why: {
    label: 'Why you can trust the numbers',
    heading: 'The service works through your price list as meticulously as a seasoned broker',
    intro:
      'For the code and rates to be right, you first have to read the file correctly and understand what the product actually is. The service goes through the same steps a broker would, and flags borderline line items for manual review.',
    items: [
      {
        title: 'Table structure and currency',
        text: 'It finds the columns for name, price, weight, and quantity on its own — in any order and under any headers. It detects the document’s currency.',
      },
      {
        title: 'Translating product names',
        text: 'It translates Chinese and English names into Russian — without an accurate description there’s no accurate HS code.',
      },
      {
        title: 'Country of origin',
        text: 'It determines the country even when the file doesn’t state it explicitly. Change it manually if needed — recalculation is one click away.',
      },
      {
        title: 'HS code',
        text: 'The code is matched in the FTS tariff database and checked against the product description. Borderline codes are flagged yellow, “check.”',
      },
      {
        title: 'Recognition from photos',
        text: 'If product photos are embedded in the xlsx and a code is in doubt, the service checks the code against the photo and confirms or corrects it.',
      },
      {
        title: 'Regulatory requirements',
        text: 'EAEU technical regulations (TR CU/EAEU) certification, licenses, Chestny ZNAK labeling, the recycling fee, and country-specific bans — summarized for each line item.',
      },
    ],
  },

  limits: {
    label: 'Scope and limits',
    heading: 'Where we are enough, and where you need a declarant',
    intro:
      'HS classification is not always clear-cut, and it is fairer to say up front where the calculation settles the question and where the decision stays with a human.',
    enough: {
      title: 'We are enough',
      items: [
        'Estimating landed cost and deal margin before shipping',
        'Getting codes and rates across the whole range at once, not product by product',
        'Understanding which certificates and permits you need, and when to start them',
        'Preparing the goods section for declaration software without retyping',
      ],
    },
    human: {
      title: 'You need a declarant or broker',
      items: [
        'Filing the declaration at customs — that is the customs representative’s job',
        'Multi-function products, sets, and components where one detail changes the code',
        'Obtaining a binding tariff ruling when the code is critical to the deal',
        'The final call on a code before filing — that responsibility sits with the declarant',
      ],
    },
    note:
      'We do not hide uncertain lines: in the file they are flagged amber with the classification confidence and the reason for doubt, so you can see exactly which rows to re-check before filing.',
  },

  calc: {
    label: 'What’s inside the calculation',
    heading: 'It catches what’s easy to miss by hand',
    intro:
      'Complex rates and a multi-step VAT base are the main sources of errors when importing. The service covers them by default.',
    items: [
      {
        title: 'Combined rates',
        text: 'For example, max(15% of value, 1.4 EUR per pair). The service parses the wording from the tariff database and applies the correct formula.',
      },
      {
        title: 'Excise',
        text: 'For excisable goods — a separate line in the calculation. It’s factored into the VAT base.',
      },
      {
        title: 'VAT on the full base',
        text: 'VAT is calculated on the value of the goods, duty, and excise combined — as customs requires. No mixed-up base.',
      },
      {
        title: 'Conditional rules',
        text: 'Rates that change depending on the country of origin or on whether the goods are excisable are recognized and applied automatically.',
      },
      {
        title: 'Any currency',
        text: 'Yuan, dollars, euros, and dozens more — converted at the CBR exchange rate. In the Excel, amounts appear in the original currency and in rubles.',
      },
      {
        title: 'Freight to the border',
        text: 'The cost of delivery to the border is distributed across line items in proportion to weight and included in the customs value — that is, in the base for duty, excise, and VAT, as the EAEU Customs Code requires.',
      },
      {
        title: 'Incoterms',
        text: 'Delivery terms — EXW, FOB, CIF, DDP, and others — define what’s already in the price and what has to be added to the customs value. The service accounts for the term and warns you when freight risks being double-counted or, conversely, the value is understated.',
      },
      {
        title: 'Logistics',
        text: 'A configurable formula: a percentage of the value, a per-kilogram rate, and a fixed delivery fee. Tailored to how you work.',
      },
    ],
  },

  guarantee: {
    label: 'Accuracy guarantee',
    heading: 'We stand behind every code',
    intro:
      'You can’t promise HS code accuracy with words alone — so we back it with process and commitment: we flag anything borderline, rely on the official tariff database, and fix mistakes at our own expense.',
    items: [
      {
        title: 'We don’t guess',
        text: 'Unambiguous codes are marked green, borderline ones yellow, “check,” and reviewed by hand. The calculation shows at a glance where everything is solid and where extra review is needed.',
      },
      {
        title: 'Rates come from the FTS tariff database',
        text: 'Every code and rate is taken from the official FTS tariff database — the same source customs itself works from.',
      },
      {
        title: 'If we’re wrong, we recalculate on us',
        text: 'Find an error in a code or rate and we’ll recalculate for free and give you 50% off your next 100 line items. We back the result with our money.',
      },
    ],
  },

  faq: {
    label: 'Questions',
    heading: 'The essentials, briefly',
    items: [
      {
        q: 'Is this a ready customs declaration?',
        a: 'No. DirectPort gives you an accurate calculation of duties, VAT, excise, and logistics across your whole price list — so you can assess the landed cost and the deal’s profitability before you even ship. Filing the declaration at customs is a separate step, handled by your broker or customs representative based on our calculation.',
      },
      {
        q: 'How much can I trust the HS codes?',
        a: 'Codes are matched against the official FTS tariff database and pass AI verification. Unambiguous ones are marked green, borderline ones yellow, “check,” and reviewed by hand. If a code or rate does turn out to be wrong, we’ll recalculate for free.',
      },
      {
        q: 'What about the confidentiality of my price list?',
        a: 'The file is used only to calculate your order. We don’t share price lists, purchase prices, or counterparties with third parties, and we never publish them anywhere.',
      },
      {
        q: 'Do I need to register or install software?',
        a: 'No. Everything happens in Telegram: message the bot, send your price list, and a manager guides you to the finished file. No dashboard, no software to install.',
      },
      {
        q: 'How long does the calculation take?',
        a: 'The calculation itself takes about 10 minutes for the whole price list, whether it holds 10 line items or 500. The overall turnaround depends on how ready the file is and whether any individual products need clarification.',
      },
      {
        q: 'How and what do I pay for?',
        a: 'You top up your balance through a manager — $1 per line item. We only charge for rows we successfully process; borderline and unrecognized items aren’t billed. No subscriptions, no monthly fees: the rate is known upfront, and you’re never charged for more line items than your file has rows.',
      },
      {
        q: 'In what format should I send the price list?',
        a: 'Excel or CSV in any language (often Chinese) and any currency. The service finds the right columns in any order on its own, translates the product names, and detects the currency — no need to reformat the file by hand.',
      },
      {
        q: 'We ship the same goods over and over — does every calculation start from scratch?',
        a: 'No. Confirmed codes are saved to your catalog: on the next calculation, line items with the same description and article number get the verified code right away. Repeat shipments are calculated faster, and codes stay consistent between calculations.',
      },
      {
        q: 'Can I load the result into declaration software?',
        a: 'Yes. The calculation comes with a separate export of the goods section: Kontur.Declarant imports it directly via “Load goods from file,” and it also works with Alta and STM tools. Rows are already grouped into declaration goods.',
      },
    ],
  },

  comparePage: {
    metaTitle: 'Comparison of customs calculation and HS code lookup services — DirectPort',
    metaDescription:
      'How DirectPort compares with online customs calculators, AI HS code lookup services, declarant software (Alta-GTD, Kontur.Declarant, CTM), and customs broker services: capabilities, time for 500 line items, and pricing.',
    heading: 'Compared with other ways to cost out an import',
    intro:
      'We looked at four ways to get HS codes and customs payments for a shipment — what each does well, where it runs out, and what it costs. Data comes from public sources; where pricing is not published, we say so.',
    tableCaption: 'Compared on one task: costing out payments across a full product range',
    criterionLabel: 'Criterion',
    columns: [
      'Mini calculators',
      'AI code lookup',
      'Declaration software',
      'Customs broker',
      'DirectPort',
    ],
    rows: [
      {
        label: 'Line items at once',
        values: ['1', '1', 'entered by hand', 'no limit', 'up to 500 from a file'],
      },
      {
        label: 'Finds the HS code',
        values: ['no, you enter it', 'yes', 'no, you enter it', 'yes, manually', 'yes, with verification'],
      },
      { label: 'Duty, VAT, excise', values: ['yes', 'yes', 'yes', 'yes', 'yes'] },
      {
        label: 'Freight and Incoterms in customs value',
        values: ['no', 'no', 'manually', 'yes', 'yes'],
      },
      {
        label: 'Regulatory documents',
        values: ['no', 'partly', 'reference only', 'yes', 'checklist by stage with box 44 codes'],
      },
      {
        label: 'Draft declaration',
        values: ['no', 'no', 'you fill it in', 'yes', 'draft of boxes 31–47'],
      },
      { label: 'Export to declaration software', values: ['no', 'no', '—', '—', 'separate file'] },
      {
        label: 'Time for 500 line items',
        values: ['not applicable', 'not applicable', 'days', 'days to weeks', 'about 10 minutes'],
      },
      {
        label: 'Price',
        values: [
          'free, or from 3 ₽ per query',
          '3 codes free, then on request',
          '29,000 to 195,000 ₽ per year',
          'from 100 ₽ per line item plus from 5,000 ₽ per declaration',
          '$1 per line item, first 50 free',
        ],
      },
    ],
    sections: [
      {
        title: 'Customs payment mini calculators',
        who: 'TKS, Taksa Online by Alta-Soft, and calculators on logistics company websites.',
        good: 'A quick estimate of payments when the HS code is already known. Free or nearly free: Alta gives 10 free queries a month, then charges 3 ₽ per query.',
        limit: 'You supply the code — the calculator neither finds nor checks it. One product at a time, with no regulatory requirements or shipment documents.',
        us: 'We have that calculator too, and ours is free. The difference starts when there is more than one product and the code is not known in advance.',
      },
      {
        title: 'AI HS code lookup services',
        who: 'INSAL, WBCON, TerminalZM and similar — usually free services run by logistics companies.',
        good: 'They return an indicative code from a product description in about a minute, often with reasoning and basic rates. A good way to sanity-check a single product.',
        limit: 'One product at a time, entered through a form. The result is positioned as a preliminary reference; paid tariffs are usually not published, so you leave a request and wait for a sales call.',
        us: 'We take the whole file: up to 500 line items in one run, with a draft declaration, a document checklist, and an export for declaration software. Our price is published and there is no one to wait for.',
      },
      {
        title: 'Declarant software',
        who: 'Alta-GTD, Kontur.Declarant, CTM VED-Declarant.',
        good: 'The professional declarant’s core tool: filling and filing declarations, checks against customs databases, electronic declaration. Indispensable at the filing stage.',
        limit: 'A human enters the HS code — there is no automatic classification. The goods section of a multi-line shipment is typed in by hand. A workstation costs from 29,000 ₽ per licence up to 195,000 ₽ a year.',
        us: 'We do not compete with them, we prepare data for them: the goods section is exported as a separate file that Kontur.Declarant imports directly, and that Alta and CTM converters accept once a mapping is configured.',
      },
      {
        title: 'Customs broker',
        who: 'Customs representatives and brokerage companies.',
        good: 'They take on liability and file the declaration. For complex and disputed cases this is the only right path.',
        limit: 'Classification is manual: for typical price lists that is from 100 ₽ per line item, plus from 5,000 ₽ for the declaration and a surcharge for each additional goods item. A multi-line shipment stretches into days and weeks.',
        us: 'We do not replace a broker and we do not file declarations. We remove the manual part: the calculation for the whole price list arrives ready, and the broker only checks the flagged lines and files.',
      },
    ],
    disclaimerTitle: 'How to read this comparison',
    disclaimer:
      'The data comes from public sources — vendor websites and price lists — as of 5 September 2026; prices and capabilities may have changed since. The comparison covers one task: calculating customs payments and finding codes across a full shipment range. In their own domains — filing declarations, freight forwarding, representing you at customs — the tools and companies listed here remain the specialists, and we do not replace them.',
    sourcesTitle: 'Sources',
    sources: [
      { name: 'Alta-Soft — price list for software and online services', url: 'https://www.alta.ru/price/' },
      { name: 'Alta-Soft — Taksa Online', url: 'https://www.alta.ru/taksa-online/' },
      { name: 'INSAL — AI HS code lookup', url: 'https://insal.ru/tn-ved/' },
      { name: 'GTK Service — customs broker price list', url: 'https://www.gtk-s.ru/price.html' },
      { name: 'Kontur.Declarant', url: 'https://kontur.ru/declarant' },
    ],
    ctaHeading: 'Check it on your own price list',
    ctaText:
      'The first 50 line items are free — comparing is easier on your own products than on someone else’s table.',
  },

  finalCta: {
    heading: 'We’ll cost out your container in 10 minutes',
    text: 'Message us on Telegram and send your price list — we’ll calculate your first 50 line items for free. After that, $1 per line item, no subscriptions.',
    ctaTelegram: 'Send your price list on Telegram',
    ctaEmail: 'Email us',
  },
};
