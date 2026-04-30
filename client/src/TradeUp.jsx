import { useState, useEffect, useMemo } from 'react';

const RARITY_ORDER = [
  "Consumer Grade", "Industrial Grade", "Mil-Spec Grade",
  "Restricted", "Classified", "Covert", "Extraordinary"
];
const RARITY_COLORS = {
  "Consumer Grade": "#b0c3d9", "Industrial Grade": "#5e98d9",
  "Mil-Spec Grade": "#4b69ff", "Restricted": "#8847ff",
  "Classified": "#d32ce6", "Covert": "#eb4b4b",
  "Extraordinary": "#e4ae39"
};
const WEAR_RANGES = [
  { name: "Factory New", short: "FN", min: 0, max: 0.07 },
  { name: "Minimal Wear", short: "MW", min: 0.07, max: 0.15 },
  { name: "Field-Tested", short: "FT", min: 0.15, max: 0.38 },
  { name: "Well-Worn", short: "WW", min: 0.38, max: 0.45 },
  { name: "Battle-Scarred", short: "BS", min: 0.45, max: 1.0 }
];

function nextRarity(r) {
  const i = RARITY_ORDER.indexOf(r);
  return i >= 0 && i < RARITY_ORDER.length - 1 ? RARITY_ORDER[i + 1] : null;
}

function getWear(float) {
  return WEAR_RANGES.find(w => float >= w.min && float < w.max) || WEAR_RANGES[4];
}

// CS2 Trade Up output float formula:
// output_float = avg(input_floats) * (output_max - output_min) + output_min
function calcOutputFloat(inputFloats, outputMin, outputMax) {
  if (inputFloats.length === 0) return 0;
  const avg = inputFloats.reduce((s, f) => s + f, 0) / inputFloats.length;
  return avg * (outputMax - outputMin) + outputMin;
}

export default function TradeUp() {
  const [skins, setSkins] = useState([]);
  const [knives, setKnives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inputs, setInputs] = useState(Array(10).fill(null)); // {skin, float}
  const [search, setSearch] = useState('');
  const [filterRarity, setFilterRarity] = useState('');
  const [filterCollection, setFilterCollection] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json').then(r => r.json()),
      fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json').then(r => r.json())
    ]).then(([skinsData, cratesData]) => {
      const parsed = skinsData.flatMap(skin => {
        if (!skin.rarity || !skin.collections?.length) return [];
        const rarityName = skin.rarity.name;
        if (!RARITY_ORDER.includes(rarityName)) return [];
        return skin.collections.map(col => ({
          id: skin.id, name: skin.name,
          weapon: skin.weapon?.name || '',
          skin: skin.pattern?.name || '',
          rarity: rarityName,
          rarityColor: skin.rarity.color || '',
          collection: col.name, collectionId: col.id,
          image: skin.image || '',
          minFloat: skin.min_float ?? 0,
          maxFloat: skin.max_float ?? 1,
          stattrak: skin.stattrak || false
        }));
      });
      setSkins(parsed);

      const knifeList = cratesData.flatMap(crate => {
        if (!crate.contains_rare?.length) return [];
        return crate.contains_rare.map(item => ({
          id: item.id, name: item.name,
          weapon: item.weapon?.name || '★',
          skin: item.pattern?.name || '',
          rarity: 'Extraordinary', rarityColor: 'e4ae39',
          collection: crate.name, collectionId: crate.id,
          image: item.image || '',
          minFloat: item.min_float ?? 0, maxFloat: item.max_float ?? 1
        }));
      });
      setKnives(knifeList);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const currentRarity = inputs.find(i => i)?.rarity || null;
  const outputRarity = currentRarity ? nextRarity(currentRarity) : null;
  const filledInputs = inputs.filter(Boolean);
  const filledCount = filledInputs.length;
  const inputFloats = filledInputs.map(i => i.float);
  const avgFloat = filledCount > 0 ? inputFloats.reduce((s, f) => s + f, 0) / filledCount : 0;

  const allCollections = useMemo(() => {
    const map = new Map();
    skins.forEach(s => map.set(s.collectionId, s.collection));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [skins]);

  const filteredSkins = useMemo(() => {
    return skins.filter(s => {
      if (currentRarity && s.rarity !== currentRarity) return false;
      if (!currentRarity && filterRarity && s.rarity !== filterRarity) return false;
      if (!currentRarity && !filterRarity && s.rarity === 'Extraordinary') return false;
      if (filterCollection && s.collectionId !== filterCollection) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${s.weapon} ${s.skin} ${s.collection}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [skins, currentRarity, filterRarity, filterCollection, search]);

  // Calculate outcomes with float
  const outcomes = useMemo(() => {
    if (filledCount === 0 || !outputRarity) return [];

    if (currentRarity === 'Covert') {
      if (knives.length === 0) return [{ weapon: '★ Knife / Glove', skin: 'Random', collection: 'Pool', probability: 1, rarity: 'Extraordinary', rarityColor: 'e4ae39', image: '', outputFloat: avgFloat, wear: getWear(avgFloat) }];
      const prob = 1 / Math.min(knives.length, 50);
      return knives.slice(0, 50).map(k => {
        const outFloat = calcOutputFloat(inputFloats, k.minFloat, k.maxFloat);
        return { ...k, probability: prob, outputFloat: outFloat, wear: getWear(outFloat) };
      });
    }

    const weights = {};
    for (const inp of filledInputs) {
      weights[inp.collectionId] = (weights[inp.collectionId] || 0) + 1;
    }
    const results = [];
    for (const [colId, count] of Object.entries(weights)) {
      const outputSkins = skins.filter(s => s.collectionId === colId && s.rarity === outputRarity);
      if (outputSkins.length === 0) continue;
      const colProb = count / filledCount;
      const perSkin = colProb / outputSkins.length;
      for (const s of outputSkins) {
        const outFloat = calcOutputFloat(inputFloats, s.minFloat, s.maxFloat);
        const existing = results.find(r => r.id === s.id && r.collectionId === s.collectionId);
        if (existing) { existing.probability += perSkin; }
        else { results.push({ ...s, probability: perSkin, outputFloat: outFloat, wear: getWear(outFloat) }); }
      }
    }
    return results.sort((a, b) => b.probability - a.probability);
  }, [filledInputs, filledCount, outputRarity, skins, currentRarity, knives, inputFloats, avgFloat]);

  function addSkin(skin) {
    const idx = inputs.findIndex(i => i === null);
    if (idx === -1) return;
    const next = [...inputs];
    // Default float: middle of skin's range
    const defaultFloat = (skin.minFloat + skin.maxFloat) / 2;
    next[idx] = { ...skin, float: defaultFloat };
    setInputs(next);
  }

  function updateFloat(idx, val) {
    const next = [...inputs];
    const slot = next[idx];
    if (!slot) return;
    const f = Math.max(slot.minFloat, Math.min(slot.maxFloat, parseFloat(val) || 0));
    next[idx] = { ...slot, float: f };
    setInputs(next);
  }

  function removeSkin(idx) {
    const next = [...inputs];
    next.splice(idx, 1);
    while (next.length < 10) next.push(null);
    setInputs(next);
  }

  function fillAll(skin) {
    const defaultFloat = (skin.minFloat + skin.maxFloat) / 2;
    setInputs(inputs.map(slot => slot || { ...skin, float: defaultFloat }));
  }

  function clearAll() { setInputs(Array(10).fill(null)); }

  if (loading) return <div className="tu-loading">Skin veritabani yukleniyor...</div>;

  return (
    <div className="tu-page">
      <aside className="tu-browser">
        <h3>Skin Sec</h3>
        <input className="tu-search" placeholder="Ara..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="tu-filters">
          <select value={filterRarity} onChange={e => setFilterRarity(e.target.value)} disabled={!!currentRarity}>
            <option value="">Any Rarity</option>
            {RARITY_ORDER.slice(0, -1).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterCollection} onChange={e => setFilterCollection(e.target.value)}>
            <option value="">Any Collection</option>
            {allCollections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="tu-skin-list">
          {filteredSkins.slice(0, 100).map((s, i) => (
            <div key={`${s.id}-${s.collectionId}-${i}`} className="tu-skin-item" onClick={() => addSkin(s)}>
              <div className="tu-skin-left">
                {s.image && <img className="tu-skin-thumb" src={s.image} alt="" loading="lazy" />}
                <div className="tu-skin-info">
                  <span className="tu-skin-name">{s.weapon} | {s.skin}</span>
                  <span className="tu-skin-col">{s.collection}</span>
                </div>
              </div>
              <div className="tu-skin-meta">
                <span className="tu-skin-rarity" style={{ color: `#${s.rarityColor}` }}>{s.rarity}</span>
                <span className="tu-skin-float">{s.minFloat.toFixed(2)} - {s.maxFloat.toFixed(2)}</span>
              </div>
            </div>
          ))}
          {filteredSkins.length === 0 && <p className="tu-empty-msg">Skin bulunamadi</p>}
          {filteredSkins.length > 100 && <p className="tu-empty-msg">+{filteredSkins.length - 100} daha... Aramayi daralt</p>}
        </div>
      </aside>

      <main className="tu-main">
        <div className="tu-header">
          <h1>Trade Up Contract</h1>
          <button className="tu-reset-btn" onClick={clearAll}>Sifirla</button>
        </div>

        {/* Inputs */}
        <div className="tu-section">
          <div className="tu-label">
            INPUT ({filledCount}/10)
            {currentRarity && <span style={{ color: RARITY_COLORS[currentRarity] }}> — {currentRarity}</span>}
            {filledCount > 0 && <span className="tu-avg-float"> | Avg Float: {avgFloat.toFixed(6)}</span>}
          </div>
          <div className="tu-slots">
            {inputs.map((slot, i) => (
              <div key={i} className={`tu-slot ${slot ? 'filled' : 'empty'}`}
                style={slot ? { borderBottomColor: `#${slot.rarityColor}` } : {}}>
                {slot ? (
                  <>
                    <button className="tu-slot-x" onClick={() => removeSkin(i)}>×</button>
                    {slot.image && <img className="tu-slot-img" src={slot.image} alt="" />}
                    <span className="tu-slot-weapon">{slot.weapon}</span>
                    <span className="tu-slot-skin">{slot.skin}</span>
                    <div className="tu-wear-btns">
                      {WEAR_RANGES.map(w => {
                        const wearFloat = Math.max(slot.minFloat, Math.min(slot.maxFloat, (w.min + w.max) / 2));
                        const possible = slot.minFloat < w.max && slot.maxFloat > w.min;
                        return <button key={w.short} className={`tu-wear-btn ${getWear(slot.float).short === w.short ? 'active' : ''}`}
                          disabled={!possible}
                          onClick={() => updateFloat(i, wearFloat)}>{w.short}</button>;
                      })}
                    </div>
                    <div className="tu-slot-float">
                      <button className="tu-float-adj" onClick={() => updateFloat(i, slot.float - 0.001)}>−</button>
                      <span className="tu-float-val">{slot.float.toFixed(4)}</span>
                      <button className="tu-float-adj" onClick={() => updateFloat(i, slot.float + 0.001)}>+</button>
                    </div>
                  </>
                ) : (
                  <span className="tu-slot-empty">+</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Outcomes */}
        <div className="tu-section">
          <div className="tu-label">
            OUTPUT
            {outputRarity && <span style={{ color: RARITY_COLORS[outputRarity] }}> — {outputRarity === 'Extraordinary' ? '★ Knife / Glove' : outputRarity}</span>}
          </div>
          {filledCount === 0 ? (
            <p className="tu-hint">Soldan skin ekle. 10 ayni rarity skin sec, float degerlerini ayarla → cikis float ve wear hesaplanir.</p>
          ) : outcomes.length === 0 ? (
            <p className="tu-hint">Bu koleksiyonlarda ust tier ({outputRarity}) skin bulunamadi.</p>
          ) : (
            <div className="tu-outcomes">
              {outcomes.map((o, i) => (
                <div key={i} className="tu-outcome" style={{ borderLeftColor: `#${o.rarityColor}` }}>
                  <div className="tu-outcome-left">
                    {o.image && <img className="tu-outcome-img" src={o.image} alt="" loading="lazy" />}
                    <div>
                      <span className="tu-outcome-name">{o.weapon} | {o.skin}</span>
                      <span className="tu-outcome-col">{o.collection}</span>
                      <span className="tu-outcome-float">
                        Float: {o.outputFloat.toFixed(6)} — <strong>{o.wear.name}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="tu-outcome-prob">{(o.probability * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
