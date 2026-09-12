import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { Modal } from './Modal';
import { Icon, type IconName } from './Icon';

/**
 * Five steps through a whole job, shown once on the first visit and again from
 * the `?` sheet: draw, fill, check, what is left in the yard, and the files to
 * send. Short on purpose - each step names the one button that does it.
 */
const STEPS: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'pen',
    title: '1. ხაზვა',
    text: 'დახაზე ბეტონის ზედაპირის ხაზი: G, დააჭირე წერტილებზე, Enter - დასრულება. სიგრძე შეგიძლია აკრიფო: 490 და Enter. კედლის სისქე ჩართვისას მეორე მხარეც ავტომატურად დაიხაზება.',
  },
  {
    icon: 'wall',
    title: '2. შევსება',
    text: 'მონიშნე ხაზი - რეკომენდაციაში ნახავ საუკეთესო ვარიანტებს. ან „ყველას შევსება“ - ყველა ცარიელი ხაზი ერთბაშად, საუკეთესო ვარიანტით.',
  },
  {
    icon: 'check',
    title: '3. შემოწმება',
    text: '„პრობლემები“ ზემოთ: 0 ნიშნავს, ყველაფერი ემთხვევა. მწვანე ხაზი - სწორი, წითელი - ცდომილება. დააჭირე პრობლემას და ნახაზი იქ გადაგიყვანს.',
  },
  {
    icon: 'sheet',
    title: '4. ნაშთი',
    text: '„ნაშთი“ აჩვენებს, რა დარჩება მარაგში ამ ნახაზის შემდეგ, და რა არ ჰყოფნის.',
  },
  {
    icon: 'download',
    title: '5. ფაილები',
    text: '⋯ მენიუ: ბეჭდვა (PDF) და Excel - არქიტექტორის ფორმატი, ყველა ფორმულით. „მარტივი“ რეჟიმი დამალავს ყველაფერ, რაც ამ ხუთ ნაბიჯს არ სჭირდება.',
  },
];

export function TourDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setTourSeen = useEditorStore((s) => s.setTourSeen);
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  const done = () => {
    setTourSeen(true);
    closeDialog();
  };

  return (
    <Modal
      title="როგორ მუშავს"
      onClose={done}
      footer={
        <>
          <span className="tour-dots">
            {STEPS.map((_, i) => (
              <span key={i} className={i === step ? 'on' : undefined} />
            ))}
          </span>
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              უკან
            </button>
          )}
          <button className="btn primary" onClick={last ? done : () => setStep(step + 1)}>
            {last ? 'დაწყება' : 'შემდეგი'}
          </button>
        </>
      }
    >
      <div className="tour-step">
        <Icon name={current.icon} size={34} />
        <h3>{current.title}</h3>
        <p>{current.text}</p>
      </div>
    </Modal>
  );
}
