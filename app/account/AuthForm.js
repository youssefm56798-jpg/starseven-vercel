'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { login, register, pullCart } from '../../lib/session-client.js';
import { emailProblem, passwordProblem, PASSWORD_MIN } from '../../lib/credentials.js';

/**
 * Sign in and sign up, in one component because they are the same form with
 * one extra field and a different verb.
 *
 * Validation runs here for the immediate message and again on the server for
 * the actual decision — the client copy is a courtesy, never the check.
 */

const COPY = {
  ar: {
    loginTitle: 'ادخل على حسابك',
    registerTitle: 'اعمل حساب',
    loginLead: 'عشان سلتك تفضل معاك على أي جهاز، وتتابع أوردراتك.',
    registerLead: 'حساب واحد، وسلتك بتفضل معاك على الموبايل واللابتوب.',
    email: 'الإيميل',
    password: 'الباسورد',
    name: 'اسمك',
    phone: 'الموبايل',
    loginBtn: 'ادخل',
    registerBtn: 'اعمل الحساب',
    busy: 'ثانية واحدة…',
    toRegister: 'لسه معندكش حساب؟ اعمل واحد',
    toLogin: 'عندك حساب؟ ادخل',
    errors: {
      'bad-credentials': 'الإيميل أو الباسورد غلط.',
      'email-taken': 'الإيميل ده معمول بيه حساب قبل كده. جرّب تدخل بيه.',
      'too-many': 'محاولات كتير. استنى شوية وجرّب تاني.',
      'bad-email': 'الإيميل مش مظبوط.',
      'bad-password': 'الباسورد ضعيف.',
      'bad-origin': 'فيه حاجة غلط في الطلب. اعمل ريفريش وجرّب تاني.',
      generic: 'فيه حاجة وقعت. جرّب تاني.',
    },
    pw: {
      'too-short': `الباسورد لازم يبقى ${PASSWORD_MIN} حروف على الأقل.`,
      'too-long': 'الباسورد طويل أوي.',
      common: 'الباسورد ده متوقّع أوي. اختار حاجة تانية.',
      'contains-email': 'متحطش إيميلك جوه الباسورد.',
      required: 'اكتب باسورد.',
    },
    emailBad: 'اكتب إيميل صحيح.',
  },
  en: {
    loginTitle: 'Sign in',
    registerTitle: 'Create an account',
    loginLead: 'So your basket follows you between devices, and you can track your orders.',
    registerLead: 'One account, and your basket stays with you on phone and laptop.',
    email: 'Email',
    password: 'Password',
    name: 'Your name',
    phone: 'Mobile',
    loginBtn: 'Sign in',
    registerBtn: 'Create account',
    busy: 'One moment…',
    toRegister: 'No account yet? Create one',
    toLogin: 'Already have an account? Sign in',
    errors: {
      'bad-credentials': 'That email and password do not match.',
      'email-taken': 'That email already has an account. Try signing in.',
      'too-many': 'Too many attempts. Wait a little and try again.',
      'bad-email': 'That email does not look right.',
      'bad-password': 'That password is too weak.',
      'bad-origin': 'Something was wrong with that request. Refresh and try again.',
      generic: 'Something went wrong. Try again.',
    },
    pw: {
      'too-short': `Use at least ${PASSWORD_MIN} characters.`,
      'too-long': 'That password is too long.',
      common: 'That password is too easy to guess. Pick another.',
      'contains-email': 'Do not put your email inside your password.',
      required: 'Enter a password.',
    },
    emailBad: 'Enter a valid email.',
  },
};

export default function AuthForm({ lang, mode }) {
  const ar = lang === 'ar';
  const t = COPY[ar ? 'ar' : 'en'];
  const L = p => localePath(p, lang);
  const router = useRouter();
  const isRegister = mode === 'register';

  const [f, setF] = useState({ email: '', password: '', name: '', phone: '' });
  const [errs, setErrs] = useState({});
  const [top, setTop] = useState('');
  const [busy, setBusy] = useState(false);

  const set = k => e => setF(prev => ({ ...prev, [k]: e.target.value }));

  function validate() {
    const next = {};
    if (emailProblem(f.email)) next.email = t.emailBad;
    if (isRegister) {
      const p = passwordProblem(f.password, f.email);
      if (p) next.password = t.pw[p] || t.pw.required;
    } else if (!f.password) {
      next.password = t.pw.required;
    }
    setErrs(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    setTop('');
    if (!validate() || busy) return;

    setBusy(true);
    try {
      const result = isRegister
        ? await register({ email: f.email, password: f.password, name: f.name, phone: f.phone })
        : await login(f.email, f.password);

      if (!result.ok) {
        setTop(t.errors[result.error] || t.errors.generic);
        return;
      }
      // The account basket is authoritative from here on.
      await pullCart();
      router.push(L('/account'));
      router.refresh();
    } catch {
      setTop(t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const field = (key, label, type = 'text', extra = {}) => (
    <label className="fld">
      <span>{label}</span>
      <input
        type={type}
        value={f[key]}
        onChange={set(key)}
        aria-invalid={errs[key] ? 'true' : undefined}
        dir={type === 'email' || type === 'password' || type === 'tel' ? 'ltr' : undefined}
        {...extra}
      />
      {errs[key] && <em className="fld-err">{errs[key]}</em>}
    </label>
  );

  return (
    <form className="authform" onSubmit={submit} noValidate>
      <h1>{isRegister ? t.registerTitle : t.loginTitle}</h1>
      <p className="authlead">{isRegister ? t.registerLead : t.loginLead}</p>

      {top && <div className="authtop" role="alert">{top}</div>}

      {isRegister && field('name', t.name, 'text', { autoComplete: 'name', maxLength: 80 })}
      {field('email', t.email, 'email', {
        autoComplete: 'email', required: true, maxLength: 254, inputMode: 'email',
      })}
      {field('password', t.password, 'password', {
        autoComplete: isRegister ? 'new-password' : 'current-password',
        required: true, maxLength: 200,
      })}
      {isRegister && field('phone', t.phone, 'tel', { autoComplete: 'tel', maxLength: 32 })}

      <button className="btn btn-red btn-full" type="submit" disabled={busy}>
        {busy ? t.busy : isRegister ? t.registerBtn : t.loginBtn}
      </button>

      <p className="authswap">
        <Link href={L(isRegister ? '/account/login' : '/account/register')}>
          {isRegister ? t.toLogin : t.toRegister}
        </Link>
      </p>
    </form>
  );
}
