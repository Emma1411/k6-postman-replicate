interface ComingSoonProps {
  title: string;
  step?: string;
  description: string;
}

export function ComingSoon({
  title,
  step,
  description,
}: ComingSoonProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-full border px-4 py-2 text-sm text-muted-foreground">
        {step ? `Étape ${step}` : "Bientôt disponible"}
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">
        {title}
      </h1>

      <p className="mt-3 max-w-xl text-muted-foreground">
        {description}
      </p>

      <p className="mt-6 text-sm text-muted-foreground">
        Cette fonctionnalité est en préparation.
      </p>
    </div>
  );
}