import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthProvider';
import { LogIn, AlertTriangle } from 'lucide-react';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      setError(error);
    } else {
      navigate('/overview', { replace: true });
    }
  };

  const labelCls = "font-data text-[10px] uppercase tracking-[0.16em] text-bone-dim";
  const inputCls = "w-full bg-ink border border-hairline rounded-md px-3 py-2.5 text-sm text-bone font-grotesk outline-none focus:border-gold/60 focus-visible:ring-1 focus-visible:ring-gold transition-colors placeholder:text-bone-dim/50";

  return (
    <div className="min-h-dvh bg-ink text-bone flex items-center justify-center p-4 relative overflow-hidden">
      {/* Calm radial gold atmosphere */}
      <div
        className="absolute inset-0 -z-10"
        aria-hidden
        style={{
          background:
            'radial-gradient(110% 70% at 50% 0%, rgba(232,209,153,0.12), rgba(11,10,8,0) 55%),' +
            'radial-gradient(80% 60% at 80% 100%, rgba(127,149,168,0.08), rgba(11,10,8,0) 60%),' +
            '#0B0A08',
        }}
      />

      <div className="w-full max-w-[400px]">
        <div className="bg-ink-2/90 backdrop-blur-md border border-hairline rounded-xl p-7 shadow-2xl">
          {/* Brand */}
          <div className="flex items-center gap-2.5 mb-1">
            <span className="w-6 h-6 rounded-full border border-gold/50" style={{ background: 'radial-gradient(circle at 35% 30%, #F0D58C, #C9A86A 70%)' }} aria-hidden />
            <span className="font-display text-xl tracking-tight text-bone" style={{ fontWeight: 600 }}>SANZ CAPITAL</span>
          </div>
          <p className="font-data text-[10px] uppercase tracking-[0.22em] text-gold/80 mb-6">Admin access</p>

          {error && (
            <div className="mb-5 flex items-start gap-2 text-negative" role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="font-data text-xs leading-relaxed">{error}</p>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className={labelCls}>Email</label>
              <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className={labelCls}>Password</label>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            </div>

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full flex items-center justify-center gap-2 text-ink font-data text-sm rounded-md py-3 transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              style={{ background: 'linear-gradient(135deg, #E8D199, #C9A86A)', fontWeight: 600 }}
            >
              <LogIn className="w-4 h-4" />
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="font-grotesk text-xs text-bone-dim/80 mt-5">
            Public visitors don’t need to sign in — this is for managing the portfolio.
          </p>
        </div>

        <button
          onClick={() => navigate('/overview')}
          className="w-full mt-5 text-center font-data text-xs text-bone-dim hover:text-gold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          ← Back to public overview
        </button>
      </div>
    </div>
  );
}
