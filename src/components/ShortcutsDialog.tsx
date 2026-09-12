import type { ReactNode } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { combo, overrideLabel } from '../lib/platform';
import { Modal } from './Modal';

/**
 * Every key in one place, opened with `?`.
 *
 * The status bar keeps four hints and the tooltips carry the rest, which is
 * right for a first look and wrong for the tenth: by then the question is
 * "what was the key for that", and it deserves one answer.
 */
export function ShortcutsDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const openDialog = useEditorStore((s) => s.openDialog);

  const groups: Array<[string, Array<[ReactNode, string]>]> = [
    [
      'ხაზვა',
      [
        ['G', 'ხაზვა - გარე პერიმეტრი'],
        [combo(['shift', 'G']), 'ხაზვა - შიდა პერიმეტრი'],
        ['490 + Enter', 'მონაკვეთი აკრეფილი სიგრძით, მაუსის მიმართულებით'],
        ['490 + ←↑→↓', 'მონაკვეთი აკრეფილი სიგრძით, ისრის მიმართულებით'],
        ['Enter', 'ხაზის დასრულება'],
        ['Backspace', 'ბოლო წერტილის მოშორება'],
        ['Esc', 'ხაზის გაუქმება'],
        [`${overrideLabel()} + თრევა`, 'თავისუფალი კუთხე'],
      ],
    ],
    [
      'გაზომვა',
      [
        ['M', 'გაზომვა'],
        ['H', 'დამხმარე ჩართ./გამორთ.'],
        ['Alt', 'დამხმარე დროებით გამორთ.'],
        ['Shift', '15° კუთხეები'],
        ['Esc', 'გაუქმება'],
      ],
    ],
    [
      'ელემენტები',
      [
        ['R', 'მოტრიალება 90°'],
        ['Delete', 'წაშლა'],
        [combo(['mod', 'D']), 'დუბლირება'],
        [combo(['mod', 'C']), 'კოპირება'],
        [combo(['mod', 'V']), 'ჩასმა'],
        [combo(['mod', 'A']), 'ყველას მონიშნვა'],
        ['Esc', 'მონიშნვის მოხსნა'],
        [`${combo(['shift'])} + თრევა`, 'სწორ ხაზზე'],
      ],
    ],
    [
      'ზოგადი',
      [
        [combo(['mod', 'Z']), 'დაბრუნება'],
        [combo(['mod', 'shift', 'Z']), 'გამეორება'],
        [combo(['mod', 'K']), 'ძებნა - ყველა მოქმედება'],
        ['Space + თრევა', 'ხედის გადაწევა'],
        ['D', 'ყველა ზომის ჩვენება/დამალვა'],
        ['V', 'არჩევა'],
        ['?', 'ეს სია'],
      ],
    ],
  ];

  return (
    <Modal
      title="კლავიშები"
      wide
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={() => openDialog({ kind: 'tour' })}>
            ტური თავიდან
          </button>
          <button className="btn primary" onClick={closeDialog}>
            დახურვა
          </button>
        </>
      }
    >
      <div className="keys-grid">
        {groups.map(([title, rows]) => (
          <section key={title}>
            <h4 className="section-title">{title}</h4>
            {rows.map(([key, what], i) => (
              <div className="keys-row" key={i}>
                <kbd>{key}</kbd>
                <span>{what}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
