import { incotermsFreightNote } from './product-notes';

describe('incotermsFreightNote', () => {
  it('null без условий поставки', () => {
    expect(incotermsFreightNote({ incoterms: null, freightCost: 100 })).toBeNull();
  });

  it.each(['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'])(
    '%s + заданный фрахт → warning о двойном счёте',
    (incoterms) => {
      const note = incotermsFreightNote({ incoterms, freightCost: 500 });
      expect(note).not.toBeNull();
      expect(note!.severity).toBe('warning');
      expect(note!.field).toBe('freight');
      expect(note!.message).toContain('двойного');
    },
  );

  it.each(['EXW', 'FCA', 'FAS', 'FOB'])('%s без фрахта → warning о занижении стоимости', (incoterms) => {
    const note = incotermsFreightNote({ incoterms, freightCost: null });
    expect(note).not.toBeNull();
    expect(note!.severity).toBe('warning');
    expect(note!.message).toContain('занижены');
  });

  it.each(['DAP', 'DPU', 'DDP'])(
    '%s без фрахта → warning о завышении стоимости (плечо по РФ / пошлины)',
    (incoterms) => {
      const note = incotermsFreightNote({ incoterms, freightCost: null });
      expect(note).not.toBeNull();
      expect(note!.severity).toBe('warning');
      expect(note!.field).toBe('freight');
      expect(note!.message).toContain('завышены');
    },
  );

  it('DDP без фрахта — предупреждение упоминает ввозные пошлины', () => {
    const note = incotermsFreightNote({ incoterms: 'DDP', freightCost: 0 });
    expect(note).not.toBeNull();
    expect(note!.message).toContain('пошлины');
  });

  it('корректные комбинации — без заметок', () => {
    // Чистый C-термин без фрахта: продавец оплатил перевозку до границы, стоимость уже полная.
    expect(incotermsFreightNote({ incoterms: 'CIF', freightCost: null })).toBeNull();
    expect(incotermsFreightNote({ incoterms: 'CPT', freightCost: null })).toBeNull();
    // Покупатель платит за перевозку и фрахт задан — как и должно быть.
    expect(incotermsFreightNote({ incoterms: 'FOB', freightCost: 800 })).toBeNull();
    expect(incotermsFreightNote({ incoterms: 'EXW', freightCost: 1200 })).toBeNull();
  });
});
