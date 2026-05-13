import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowRight, Bot, ChartCandlestick, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const LandingPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const handleTryNow = () => {
    navigate(isAuthenticated ? '/dashboard' : '/login');
  };

  const handleSeeDashboard = () => {
    navigate(isAuthenticated ? '/dashboard' : '/register');
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-10">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/75 p-8 shadow-2xl backdrop-blur md:p-12">
        <div className="pointer-events-none absolute -left-24 top-[-5rem] h-52 w-52 rounded-full bg-primary/25 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-48 w-48 rounded-full bg-blue-500/20 blur-3xl" />

        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Polymarket Intelligence Platform</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
          Rebuild your trading workflow around conviction, not noise.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
          Dark-first command center for signal discovery, AI market reasoning, and execution support from one interface.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" onClick={handleTryNow}>
            Start Free Now
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline" onClick={handleSeeDashboard}>
            View Platform
          </Button>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="h-5 w-5 text-primary" />
              AI Operator Chat
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Streamed assistant answers with direct ties to current market events and account context.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ChartCandlestick className="h-5 w-5 text-primary" />
              Events + Trading
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Find high-volume opportunities and move quickly into order workflows from the same control surface.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Operator Grade
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Built for teams that need stable dashboards, clear risk visibility, and fast operational loops.
          </CardContent>
        </Card>
      </section>
    </div>
  );
};
