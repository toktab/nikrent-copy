/**
 * Georgian — the source language.
 *
 * This file defines the key set: every other locale is type-checked against it,
 * so adding a language cannot silently ship with holes, and a typo'd key is a
 * compile error rather than a blank label discovered by a user.
 *
 * Keys are `area.thing`, named for meaning rather than for the words. Renaming
 * a button should not require renaming its key.
 *
 * Placeholders are `{name}`. Keep whole sentences in one entry — assembling
 * them from fragments does not survive a language whose word order differs.
 */
export const ka = {
  // ── sign in ──
  'auth.appName': 'კუბი',
  'auth.signInHint': 'შესასვლელად გამოიყენე სამუშაო ელფოსტა',
  'auth.recoverHint': 'შეიყვანე ელფოსტა და გამოგიგზავნით აღდგენის ბმულს',
  'auth.email': 'ელფოსტა',
  'auth.password': 'პაროლი',
  'auth.signIn': 'შესვლა',
  'auth.signingIn': '…',
  'auth.remember': 'დამახსოვრება - ბრაუზერის დახურვის შემდეგაც შესული დავრჩე',
  'auth.rememberHint':
    'საერთო კომპიუტერზე მოხსენი „დამახსოვრება“ - მაშინ ბრაუზერის დახურვისას სესია დასრულდება.',
  'auth.forgot': 'პაროლი დაგავიწყდა?',
  'auth.backToSignIn': 'შესვლა',
  'auth.sendLink': 'ბმულის გამოგზავნა',
  'auth.checkEmail': 'შეამოწმე ელფოსტა',
  'auth.checkEmailBody':
    'თუ ამ მისამართზე ანგარიში არსებობს, გამოგზავნილია ბმული პაროლის აღსადგენად.',
  'auth.checkEmailHint':
    'წერილი რამდენიმე წუთში არ მოვიდა? შეამოწმე სპამი, ან სთხოვე ადმინისტრატორს ახალი პაროლის გენერაცია - ეს ყოველთვის მუშაობს.',
  'auth.backToSignInPage': 'შესვლის გვერდზე დაბრუნება',
  'auth.loading': 'იტვირთება…',
  'auth.profileLoading': 'პროფილი იტვირთება…',
  'auth.incompleteAccount': 'ანგარიში არ არის სრული',
  'auth.signOut': 'გამოსვლა',

  // ── password recovery ──
  'recovery.title': 'ახალი პაროლის დაყენება',
  'recovery.subtitle': 'აირჩიე ახალი პაროლი - ძველი აღარ იმუშავებს.',
  'recovery.newPassword': 'ახალი პაროლი',
  'recovery.repeat': 'გაიმეორე',
  'recovery.save': 'შენახვა და გაგრძელება',
  'recovery.cancel': 'გაუქმება და გამოსვლა',
  'recovery.minLength': 'მინიმუმ {n} სიმბოლო.',
  'recovery.mismatch': 'პაროლები არ ემთხვევა.',

  // ── errors surfaced to the user ──
  'error.badCredentials': 'არასწორი ელფოსტა ან პაროლი.',
  'error.emailNotConfirmed': 'ელფოსტა არ არის დადასტურებული.',
  'error.rateLimited': 'ძალიან ბევრი მცდელობა. სცადე ცოტა ხანში.',
  'error.signupDisabled': 'ახალი ანგარიშის შექმნა გამორთულია. მიმართე ადმინისტრატორს.',
  'error.network': 'სერვერთან კავშირი ვერ მოხერხდა. შეამოწმე ინტერნეტი.',
  'error.noProfile': 'ანგარიშს არ აქვს პროფილი. მიმართე ადმინისტრატორს.',
  'error.mailQuota':
    'ელფოსტის გაგზავნის ლიმიტი ამოიწურა. სცადე ერთ საათში ან მიმართე ადმინისტრატორს.',

  // ── roles ──
  'role.admin': 'ადმინისტრატორი',
  'role.editor': 'რედაქტორი',
  'role.viewer': 'მხოლოდ ნახვა',
  'role.adminCan': 'შეგიძლია ყველაფრის შეცვლა',
  'role.editorCan': 'შეგიძლია ნახაზების შეცვლა',
  'role.viewerCan': 'მხოლოდ ნახვა შეგიძლია',
  'role.adminOnly': 'მხოლოდ ადმინისტრატორს შეუძლია კატალოგისა და მარაგის შეცვლა',
} as const;

export type MessageKey = keyof typeof ka;
export type Messages = Record<MessageKey, string>;
