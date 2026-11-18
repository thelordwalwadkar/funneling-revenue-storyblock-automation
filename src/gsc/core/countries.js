// Search Console's API uses lowercase ISO-3166 alpha-3 country codes ("usa", "gbr"). Exports often use names.
export const COUNTRIES = [
  ['usa', 'United States'], ['gbr', 'United Kingdom'], ['ind', 'India'], ['can', 'Canada'], ['aus', 'Australia'], ['deu', 'Germany'],
  ['fra', 'France'], ['nld', 'Netherlands'], ['esp', 'Spain'], ['ita', 'Italy'], ['bra', 'Brazil'], ['mex', 'Mexico'], ['jpn', 'Japan'],
  ['sgp', 'Singapore'], ['are', 'United Arab Emirates'], ['zaf', 'South Africa'], ['irl', 'Ireland'], ['nzl', 'New Zealand'],
  ['pak', 'Pakistan'], ['phl', 'Philippines'], ['idn', 'Indonesia'], ['sau', 'Saudi Arabia'], ['bel', 'Belgium'], ['che', 'Switzerland'],
  ['swe', 'Sweden'], ['pol', 'Poland'], ['tur', 'Türkiye'], ['kor', 'South Korea'], ['chn', 'China'], ['rus', 'Russia'], ['aut', 'Austria'],
  ['dnk', 'Denmark'], ['nor', 'Norway'], ['fin', 'Finland'], ['prt', 'Portugal'], ['mys', 'Malaysia'], ['tha', 'Thailand'],
  ['vnm', 'Vietnam'], ['bgd', 'Bangladesh'], ['lka', 'Sri Lanka'], ['nga', 'Nigeria'], ['ken', 'Kenya'], ['egy', 'Egypt'], ['isr', 'Israel'],
  ['arg', 'Argentina'], ['col', 'Colombia'], ['chl', 'Chile'], ['cze', 'Czechia'], ['rou', 'Romania'], ['hun', 'Hungary'], ['grc', 'Greece'],
];

const byCode = new Map(COUNTRIES.map(([c, n]) => [c, n]));
const byName = new Map(COUNTRIES.map(([c, n]) => [n.toLowerCase(), c]));
byName.set('turkey', 'tur');
byName.set('uk', 'gbr');
byName.set('united states of america', 'usa');

/** Normalise a country value from any source (code or name) to an alpha-3 code where known. */
export function toCountryCode(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (byCode.has(s)) return s;
  return byName.get(s) || s;
}
export const countryName = (code) => byCode.get(String(code).toLowerCase()) || String(code).toUpperCase();
export const matchCountry = (rowValue, wanted) => !wanted || toCountryCode(rowValue) === toCountryCode(wanted);
