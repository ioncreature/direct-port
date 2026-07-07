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
    why: 'Why it’s accurate',
    guarantee: 'Guarantee',
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
    ctaAltPrefix: 'or',
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

  pricing: {
    label: 'Pricing',
    priceMain: '$1',
    priceUnit: ' per line item.',
    intro:
      'No subscriptions, no monthly fees. Pay only for the line items you process — you see the total before you start, and the more you run, the lower the per-item price.',
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
        a: 'You top up your balance through a manager — $1 per line item. We only charge for rows we successfully process; borderline and unrecognized items aren’t billed. No subscriptions, no monthly fees, and you see the total before you start.',
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

  finalCta: {
    heading: 'We’ll cost out your container in 10 minutes',
    text: 'Message us on Telegram and send your price list — we’ll calculate your first 50 line items for free. After that, $1 per line item, no subscriptions.',
    ctaTelegram: 'Send your price list on Telegram',
    ctaEmail: 'Email us',
  },
};
