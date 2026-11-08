import type { Material, Piece, SketchPath } from '../types';
import { boltKindOf, boltTotals } from './boltMarks';
import { findCornerRods } from './bolts';
import type { KindsOn } from './boltKinds';
import { soloPanels, walerTotals } from './walers';
import { cornerConnectorSpots, cornerConnectorTotals, smallNutTotals } from './cornerConnectors';

/**
 * What every ჭანჭიკი is, for the რეკომენდაცია panel (the user, 2026-11-07):
 * picked on the plan, it says what it is, what it is for, how many go up a 300
 * and a 150 / 90, an example of where it goes, and what goes with it - each of
 * those a link to its own card.
 *
 * Georgian, as the rest of the interface. The rules are the ones the user gave
 * and the code counts by - see the files each one names.
 */
export type BoltInfoId =
  | 'connectors'
  | 'rods'
  | 'nuts'
  | 'latches'
  | 'walers'
  | 'walerRod'
  | 'walerLock'
  | 'cornerConnectors'
  | 'halfHead'
  | 'fullHead'
  | 'innerConnectors'
  | 'smallNut'
  | 'holders'
  | 'crocodiles'
  | 'frogs'
  | 'props';

export interface BoltInfo {
  name: string;
  /** what it is */
  what: string;
  /** what it is for, and where it goes */
  use: string;
  /** how many at one place up a 300, and up a 150 or a 90 */
  per300: string;
  per150: string;
  /** an example of a place it goes, e.g. "პანელი + ჩაკერება + პანელი" */
  example: string;
  /** how it comes onto the drawing */
  placing: string;
  /** what goes on it or with it - links */
  needs: Array<{ id: BoltInfoId; note: string }>;
  /** what it is itself part of - links */
  usedBy: BoltInfoId[];
}

const AUTO = 'ავტომატურად - ჭანჭიკები → „ავტომატურად თავიდან დასმა“ (თუ პარამეტრებში მონიშნულია), ან ხელით ელემენტებიდან.';
const WORKED = 'ავტომატურად ითვლება და ნახაზზე ჩანს, როცა ჭანჭიკებში ჩართულია. მონიშნე და Delete - ამ ადგილიდან მოიხსნება; „ავტომატურად თავიდან დასმა“ აბრუნებს.';

export const BOLT_INFO: Record<BoltInfoId, BoltInfo> = {
  connectors: {
    name: 'კონექტორი 25 სმ',
    what: 'მოკლე სამაგრი, რომელიც ორ ელემენტს ერთმანეთზე ჭიმავს მათ შეერთებაზე.',
    use: 'T-შეერთებაზე - სადაც ერთი პანელის ბოლო მეორე პანელის ზედაპირს ებჯინება, შიდა კუთხის ფეხთან ჩაკერება 5 / 10-ზე, და გარე კუთხეში ჩ5-ით. ყველა ერთი ნაწილია - ჭანჭიკებში ერთ სტრიქონში ითვლება.',
    per300: '5 ც. ერთ ადგილზე',
    per150: '5 ც. ერთ ადგილზე (სიმაღლე არ ცვლის)',
    example: 'პანელის ბოლო + მეორე პანელის ზედაპირი (T)',
    placing: AUTO,
    needs: [{ id: 'nuts', note: '1 თითო კონექტორზე' }],
    usedBy: [],
  },
  rods: {
    name: 'შტირი',
    what: 'გრძელი ჭანჭიკი, რომელიც კედელს გასჭოლავს - შიდა და გარე მხარის ყალიბს ერთმანეთზე ჭიმავს ბეტონის დასხმისას.',
    use: 'იქ, სადაც შიდა მხარის შეერთება (პანელი + პანელი, პანელი + ჩაკერება) ზუსტად გარე მხარის შეერთების პირდაპირ დგას. მხოლოდ ერთ კედელში გადის. შიდა კუთხის ფეხთან - 40 სმ მთლიანთავიანი.',
    per300: '5 ც. ერთ ადგილზე',
    per150: '2 ც. ერთ ადგილზე',
    example: 'შიდა: პანელი | პანელი ↔ გარე: პანელი | პანელი, ერთმანეთის პირდაპირ',
    placing: AUTO,
    needs: [
      { id: 'nuts', note: '2 თითო შტირზე - ორივე ბოლოზე' },
      { id: 'latches', note: '300-ზე 8, 150 / 90-ზე 2 ერთ ადგილზე' },
    ],
    usedBy: ['fullHead'],
  },
  nuts: {
    name: 'ქანჩი + დისკო',
    what: 'ქანჩი საყელურით (დისკოთი) და თეთრი ფრთით - ჭანჭიკის ბოლოს ყალიბზე ჭიმავს.',
    use: 'შტირის ორივე ბოლოზე, თითო კონექტორზე, ვოლერის თითო შტირზე, გარე კუთხის კონექტორზე და ნახევართავიან შტირზე.',
    per300: 'იმდენი, რამდენიც ჭანჭიკი: შტირზე 2, დანარჩენზე 1',
    per150: 'იგივე წესი',
    example: 'შტირი × 2 + კონექტორები + ვოლერის შტირები + კუთხის კონექტორები',
    placing: 'ითვლება იმ ჭანჭიკებიდან, რომლებზეც დგება; ხელითაც შეიძლება დასმა.',
    needs: [],
    usedBy: ['rods', 'connectors', 'walerRod', 'cornerConnectors', 'halfHead', 'fullHead'],
  },
  latches: {
    name: 'ჩამკეტი fix',
    what: 'ლურჯი სამაგრი, რომელიც გვერდიგვერდ მდგარ ორ პანელს ჩარჩოებით კრავს.',
    use: 'შტირთან ერთად - ყოველი ფასადის გარე კიდეზე, შტირებს შორის.',
    per300: '8 ც. ერთ შტირის ადგილზე (4 + 4)',
    per150: '2 ც. ერთ შტირის ადგილზე (1 + 1)',
    example: 'პანელი | პანელი, შტირის გასწვრივ, ორივე ფასადზე',
    placing: AUTO,
    needs: [],
    usedBy: ['rods'],
  },
  walers: {
    name: 'ვოლერი',
    what: 'ფოლადის ძელი, რომელიც პანელს ზურგიდან ამაგრებს.',
    use: 'პანელზე, რომელსაც კედლის მეორე მხარეს პირისპირ პანელი არ აქვს (ცალმხრივი) - შტირი ვერ გაივლის, ამიტომ ვოლერი იჭერს.',
    per300: '3 ვოლერი თითო პანელზე',
    per150: '2 ვოლერი თითო პანელზე',
    example: 'ცალმხრივი პანელი: |   (და არა | |)',
    placing: WORKED,
    needs: [
      { id: 'walerRod', note: '2 თითო ვოლერზე' },
      { id: 'walerLock', note: '1 თითო ვოლერის შტირზე' },
      { id: 'nuts', note: '1 თითო ვოლერის შტირზე' },
    ],
    usedBy: [],
  },
  walerRod: {
    name: 'ვოლერის შტირი 40 სმ (მთლიანი თავით)',
    what: '40 სმ შტირი მთლიანი თავით.',
    use: 'ვოლერს პანელზე ამაგრებს - ორი თითო ვოლერზე.',
    per300: '3 ვოლერი × 2 = 6 ც. პანელზე',
    per150: '2 ვოლერი × 2 = 4 ც. პანელზე',
    example: 'ცალმხრივი პანელი + ვოლერი',
    placing: 'ითვლება ვოლერებიდან.',
    needs: [
      { id: 'walerLock', note: '1 თავზე' },
      { id: 'nuts', note: '1 თითოზე' },
    ],
    usedBy: ['walers'],
  },
  walerLock: {
    name: 'ვოლერის შტირის თავის ჩასაკეტი',
    what: 'ჩასაკეტი ვოლერის შტირის თავზე.',
    use: 'თითო ვოლერის შტირზე.',
    per300: '6 ც. პანელზე (3 ვოლერი × 2)',
    per150: '4 ც. პანელზე (2 ვოლერი × 2)',
    example: 'ვოლერის შტირის თავი',
    placing: 'ითვლება ვოლერებიდან.',
    needs: [],
    usedBy: ['walerRod', 'walers'],
  },
  cornerConnectors: {
    name: 'კუთხის კონექტორი 25 სმ - გარე',
    what: '25 სმ კონექტორი გარე კუთხისთვის.',
    use: 'გარე კუთხეში, სადაც გამავალ პანელსა და მომდევნო პანელს შორის ჩ5 დგას: გამავალი პანელის გარედან, მასში და ჩ5-ში გადის მომდევნო პანელში. მხოლოდ ჩ5-ს ერგება.',
    per300: '5 ც. ერთ ადგილზე',
    per150: '2 ც. ერთ ადგილზე',
    example: 'გამავალი პანელი + ჩ5 + პანელი (გარე კუთხე)',
    placing: WORKED,
    needs: [{ id: 'nuts', note: '1 გარე ბოლოზე' }],
    usedBy: [],
  },
  halfHead: {
    name: 'შტირი 40 სმ ნახევარი თავით (წაჭრილი გაიკა)',
    what: '40 სმ შტირი ნახევარი (წაჭრილი) თავით - არასდროს მთლიანი თავით.',
    use: 'გარე კუთხეში, სადაც გამავალ პანელსა და მომდევნო პანელს შორის ჩ10 დგას - 25 სმ კონექტორის ნაცვლად.',
    per300: '5 ც. ერთ ადგილზე',
    per150: '2 ც. ერთ ადგილზე',
    example: 'გამავალი პანელი + ჩ10 + პანელი (გარე კუთხე)',
    placing: WORKED,
    needs: [{ id: 'nuts', note: '1 გარე ბოლოზე' }],
    usedBy: [],
  },
  fullHead: {
    name: 'შტირი 40 სმ მთლიანი თავით (წაჭრის გარეშე)',
    what: '40 სმ შტირი მთლიანი (წაუჭრელი) თავით.',
    use: 'შიდა კუთხეში: სადაც შიდა კუთხის ფეხის ბოლო გარე ფასადის შეერთების პირდაპირ დგას - გარე ფასადიდან კუთხის პროფილში გადის, ჩვეულებრივი შტირის ნაცვლად. ჩამკეტი fix არ სჭირდება.',
    per300: '5 ც. ერთ ადგილზე',
    per150: '2 ც. ერთ ადგილზე',
    example: 'გარე: პანელი | პანელი ↔ შიდა: კუთხის ფეხი | პანელი',
    placing: WORKED,
    needs: [{ id: 'nuts', note: '1 გარე ბოლოზე' }],
    usedBy: [],
  },
  innerConnectors: {
    name: 'კუთხის კონექტორი 25 სმ - შიდა',
    what: 'იგივე 25 სმ კონექტორი, შიდა კუთხისთვის.',
    use: 'შიდა კუთხეში: კუთხის პროფილის ფეხიდან ჩ5-ში ან ჩ10-ში და პანელში.',
    per300: '5 ც. ერთ ადგილზე',
    per150: '2 ც. ერთ ადგილზე',
    example: 'შიდა კუთხე + ჩ5 / ჩ10 + პანელი',
    placing: WORKED,
    needs: [{ id: 'smallNut', note: '1 თითოზე - არა ქანჩი + დისკო' }],
    usedBy: [],
  },
  smallNut: {
    name: 'ბარაშკა პატარა (გილზა + გაიკა)',
    what: 'პატარა ბარაშკა - გილზა და გაიკა.',
    use: 'შიდა კუთხის 25 სმ კონექტორის ბოლოზე.',
    per300: '5 ც. ერთ ადგილზე',
    per150: '2 ც. ერთ ადგილზე',
    example: 'შიდა კუთხის კონექტორი',
    placing: 'ავტომატურად - ჭანჭიკები → „ბარაშკა პატარა“: თითო ყოველ შიდა კუთხის კონექტორზე. ხელითაც, ელემენტებიდან. ჭანჭიკებში საკუთარი სტრიქონი აქვს, თვალით და PDF-ის გადამრთველით.',
    needs: [],
    usedBy: ['innerConnectors'],
  },
  holders: {
    name: 'პანელის ბეტონზე სამაგრი',
    what: 'მილისებრი სამაგრი ორი ქინძისთავის ბუდით - პანელის ძირს ბეტონზე იჭერს.',
    use: 'ცალმხრივი პანელის (რომელსაც პირისპირ პანელი არ აქვს) ძირში, ზურგის მხარეს. პანელთან მიტანისას ავტომატურად ეკვრის.',
    per300: '1 ც. თითო დასმულზე',
    per150: '1 ც. თითო დასმულზე',
    example: 'ცალმხრივი პანელი: |',
    placing: 'მხოლოდ ხელით, ელემენტებიდან - ავტომატურად არასდროს. ყოველთვის ითვლება; ჭანჭიკებში მხოლოდ ჩვენება / დამალვა.',
    needs: [],
    usedBy: [],
  },
  crocodiles: {
    name: 'ნიანგი (ჩამკეტი რეგულირებადი)',
    what: 'რეგულირებადი სამაგრი, რომელიც პანელს, ჩაკერებას და პანელს ერთად კრავს.',
    use: 'სადაც ორ პანელს შორის ჩაკერებაა, ერთ სწორ ხაზზე - ფასადის ზურგზე, სამივეზე გადადის. შიდა / გარე კუთხეში არა.',
    per300: '4 ც. ერთ ადგილზე',
    per150: '2 ც. ერთ ადგილზე',
    example: 'პანელი + ჩაკერება + პანელი',
    placing: AUTO,
    needs: [],
    usedBy: [],
  },
  props: {
    name: 'დგარი და თავი',
    what: 'რეგულირებადი საბიჯგი (დგარი) თავით: თავი პანელის ჩარჩოს ებღაუჭება, ქვედა ფირფიტა იატაკზე მაგრდება, შუაში სახელურით სიგრძე რეგულირდება.',
    use: 'ყალიბს გარედან აბჯენს და ასწორებს - ცალმხრივ პანელზე (რომელსაც პირისპირ პანელი არ აქვს), ზურგის მხრიდან. პატარა - 150 / 90-იან პანელზე, დიდი - 300-იანზე.',
    per300: '1 დიდი თითო პანელზე',
    per150: '1 პატარა თითო პანელზე',
    example: 'ცალმხრივი პანელი: | ← დგარი',
    placing: 'ავტომატურად - ჭანჭიკები → „ავტომატურად თავიდან დასმა“: თითო ყოველ ცალმხრივ პანელზე, შუაში. ხელითაც, ელემენტებიდან - პანელთან მიტანისას ეკვრის.',
    needs: [],
    usedBy: ['walers'],
  },
  frogs: {
    name: 'ბაყაყი (სამაგრი ფიქსი)',
    what: 'სამაგრი, რომელიც გვერდიგვერდ მდგარ ორ პანელს კრავს.',
    use: 'სადაც ორი პანელი ერთმანეთს პირდაპირ ებჯინება, ჩაკერების გარეშე - ფასადის ზურგზე, ორივეზე გადადის.',
    per300: '4 ც. ერთ ადგილზე',
    per150: '2 ც. ერთ ადგილზე',
    example: 'პანელი + პანელი',
    placing: AUTO,
    needs: [],
    usedBy: [],
  },
};

/** Which card a catalog piece opens, if it is a ჭანჭიკი of any kind. */
export function boltInfoOf(m: Material): BoltInfoId | null {
  const kind = boltKindOf(m);
  if (kind) return kind;
  if (m.id === 'waler-rod-lock' || m.name.includes('ჩასაკეტი')) return 'walerLock';
  if (m.id === 'waler-rod-40' || m.name.includes('ვოლერის შტირი')) return 'walerRod';
  if (m.id === 'rod-40-half-head' || m.name.includes('ნახევარი თავით')) return 'halfHead';
  if (m.id === 'corner-connector-40' || (m.name.includes('მთლიანი თავით') && !m.name.includes('ვოლერ'))) return 'fullHead';
  if (m.id === 'acc-small-barashka' || m.name.includes('ბარაშკა')) return 'smallNut';
  return null;
}

/** How many of each the open drawing has, every course - what the ჭანჭიკები menu counts. */
export function boltInfoCounts(
  pieces: Piece[],
  byId: Map<string, Material>,
  on: KindsOn,
  sketch: SketchPath[] = [],
): Partial<Record<BoltInfoId, number>> {
  const t = boltTotals(pieces, byId, on);
  const w = walerTotals(soloPanels(pieces, byId, sketch));
  const cc = cornerConnectorTotals(cornerConnectorSpots(pieces, byId));
  return {
    connectors: t.connectors,
    rods: t.rods,
    nuts: t.nuts,
    latches: t.latches,
    holders: t.holders,
    crocodiles: t.crocodiles,
    frogs: t.frogs,
    props: t.props,
    walers: on.walers ? w.walers : 0,
    walerRod: on.walers ? w.rods : 0,
    walerLock: on.walers ? w.locks : 0,
    cornerConnectors: on.cornerConnectors ? cc.connectors : 0,
    halfHead: on.halfHead ? cc.halfHead : 0,
    fullHead: on.fullHead ? findCornerRods(pieces, byId).reduce((n, r) => n + r.count, 0) : 0,
    innerConnectors: on.innerConnectors ? cc.innerConnectors : 0,
    smallNut: on.smallNuts ? smallNutTotals(cornerConnectorSpots(pieces, byId), pieces, byId).total : 0,
  };
}
