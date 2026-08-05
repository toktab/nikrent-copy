import { useMemo, useState } from 'react';
import type { Category, MaterialDraft, Shape } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import { CATEGORY_OPTIONS } from '../lib/catalogFile';
import { categoryColor } from '../data/categories';
import { defaultDepth, PANEL_DEPTH_CM } from '../data/seedCatalog';
import { DEFAULT_WAREHOUSE, stockIn, withStockIn } from '../lib/inventory';
import { Modal } from './Modal';
import { PiecePreview } from './ShapeSvg';

const SHAPE_OPTIONS: Array<{ value: Shape; label: string }> = [
  { value: 'rect', label: 'მართკუთხედი' },
  { value: 'L', label: 'L-კუთხე' },
  { value: 'line', label: 'ხაზი / ღერო' },
];

/** Create a new component, or edit any existing one (built-ins included). */
export function MaterialFormDialog({ materialId }: { materialId?: string }) {
  const materials = useEditorStore((s) => s.materials);
  const addMaterial = useEditorStore((s) => s.addMaterial);
  const updateMaterial = useEditorStore((s) => s.updateMaterial);
  const closeDialog = useEditorStore((s) => s.closeDialog);

  const warehouses = useEditorStore((s) => s.warehouses);
  const primaryWarehouse = warehouses[0]?.id ?? DEFAULT_WAREHOUSE.id;

  const existing = materialId ? materials.find((m) => m.id === materialId) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<Category>(existing?.category ?? 'panel');
  const [w, setW] = useState(String(existing?.w ?? 45));
  const [h, setH] = useState(String(existing?.h ?? 300));
  const [shape, setShape] = useState<Shape>(existing?.shape ?? 'rect');
  const [depth, setDepth] = useState(String(existing?.depth ?? PANEL_DEPTH_CM));
  // Thickness follows the category default until the user overrides it.
  const [depthTouched, setDepthTouched] = useState(Boolean(existing));
  const [color, setColor] = useState(existing?.color ?? categoryColor('panel'));
  const [stock, setStock] = useState(String(existing ? stockIn(existing, primaryWarehouse) : 0));
  const [weight, setWeight] = useState(String(existing?.weight ?? 0));
  const [article, setArticle] = useState(existing?.article ?? '');
  const [supplier, setSupplier] = useState(existing?.supplier ?? '');
  // Colour follows the category until the user picks one explicitly.
  const [colorTouched, setColorTouched] = useState(Boolean(existing));

  const decimal = (v: string) => Number(String(v).replace(',', '.'));
  const wNum = decimal(w);
  const hNum = decimal(h);
  const stockNum = Number(stock);
  const weightNum = decimal(weight);
  const depthNum = decimal(depth);

  const errors: string[] = [];
  if (!name.trim()) errors.push('დასახელება სავალდებულოა.');
  if (!Number.isFinite(wNum) || wNum <= 0) errors.push('სიგანე უნდა იყოს დადებითი რიცხვი.');
  if (!Number.isFinite(hNum) || hNum <= 0) errors.push('სიმაღლე უნდა იყოს დადებითი რიცხვი.');
  if (!Number.isFinite(stockNum) || stockNum < 0) errors.push('მარაგი არ შეიძლება იყოს უარყოფითი.');
  if (!Number.isFinite(weightNum) || weightNum < 0) errors.push('წონა არ შეიძლება იყოს უარყოფითი.');
  if (!Number.isFinite(depthNum) || depthNum <= 0) errors.push('სისქე უნდა იყოს დადებითი რიცხვი.');

  const preview = useMemo(
    () => ({
      id: 'preview',
      name: name || '—',
      category,
      w: Number.isFinite(wNum) && wNum > 0 ? wNum : 45,
      h: Number.isFinite(hNum) && hNum > 0 ? hNum : 300,
      depth: Number.isFinite(depthNum) && depthNum > 0 ? depthNum : PANEL_DEPTH_CM,
      shape,
      color,
      builtin: false,
      stock: {},
      weight: 0,
      article: '',
      supplier: '',
    }),
    [name, category, wNum, hNum, shape, color],
  );

  const submit = () => {
    if (errors.length) return;
    // Only the primary warehouse is edited here; other stores keep their counts.
    const nextStock = withStockIn(existing?.stock ?? {}, primaryWarehouse, stockNum || 0);
    const draft: MaterialDraft = {
      name: name.trim(),
      category,
      w: wNum,
      h: hNum,
      depth: depthNum,
      shape,
      color,
      stock: nextStock,
      weight: weightNum || 0,
      article: article.trim(),
      supplier: supplier.trim(),
    };
    if (existing) updateMaterial(existing.id, draft);
    else addMaterial(draft);
    closeDialog();
  };

  const onCategoryChange = (next: Category) => {
    setCategory(next);
    if (!colorTouched) setColor(categoryColor(next));
    if (!depthTouched) setDepth(String(defaultDepth(next, wNum || 45, hNum || 300)));
  };

  return (
    <Modal
      title={existing ? `რედაქტირება — ${existing.name}` : 'ახალი კომპონენტი'}
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={closeDialog}>
            გაუქმება
          </button>
          <button className="btn primary" onClick={submit} disabled={errors.length > 0}>
            {existing ? 'შენახვა' : 'დამატება'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field span2">
          <span>დასახელება</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="მაგ. პანელი 45*300"
          />
        </label>

        <label className="field">
          <span>კატეგორია</span>
          <select value={category} onChange={(e) => onCategoryChange(e.target.value as Category)}>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>ფორმა</span>
          <select value={shape} onChange={(e) => setShape(e.target.value as Shape)}>
            {SHAPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>სიგანე (სმ)</span>
          <input type="number" min={1} step="any" value={w} onChange={(e) => setW(e.target.value)} />
        </label>

        <label className="field">
          <span>სიმაღლე (სმ)</span>
          <input type="number" min={1} step="any" value={h} onChange={(e) => setH(e.target.value)} />
        </label>

        <label className="field span2">
          <span>სისქე ნახაზზე (სმ)</span>
          <input
            type="number"
            min={0.1}
            step="any"
            value={depth}
            onChange={(e) => {
              setDepth(e.target.value);
              setDepthTouched(true);
            }}
          />
          <small className="field-hint">
            ნახაზი გეგმაშია — ჩანს <b>სიგანე × სისქე</b>. სიმაღლე ვერტიკალურია და არ ჩანს.
            Du-ს პანელები ყოველთვის {PANEL_DEPTH_CM} სმ სისქისაა.
          </small>
        </label>

        <label className="field">
          <span>ფერი</span>
          <div className="color-row">
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setColorTouched(true);
              }}
            />
            <button
              className="btn small"
              onClick={() => {
                setColor(categoryColor(category));
                setColorTouched(false);
              }}
            >
              კატეგორიის ფერი
            </button>
          </div>
        </label>

        <label className="field">
          <span>
            მარაგი (ცალი){warehouses.length > 1 ? ` — ${warehouses[0].name}` : ''}
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
        </label>

        <label className="field">
          <span>წონა (კგ)</span>
          <input
            type="number"
            min={0}
            step="any"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>

        <label className="field">
          <span>აღნიშვნა</span>
          <input value={article} onChange={(e) => setArticle(e.target.value)} placeholder="DU-…" />
        </label>

        <label className="field">
          <span>მომწოდებელი</span>
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </label>

        <div className="field span2 preview-box">
          <span>გადახედვა</span>
          <div className="preview-inner">
            <PiecePreview material={preview} box={110} />
            <div className="preview-meta">
              <b>{preview.name}</b>
              <span>
                {preview.w} × {preview.h} სმ
              </span>
            </div>
          </div>
        </div>
      </div>

      {existing?.builtin && (
        <p className="hint-note">
          ეს ჩაშენებული Du მასალაა. ცვლილება მაშინვე აისახება ზედაპირზე განთავსებულ ყველა ასეთ
          ელემენტზე.
        </p>
      )}

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
