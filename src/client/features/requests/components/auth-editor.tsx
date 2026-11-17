"use client";

import { Input } from "@/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import type { Auth } from "@/shared/schemas";

type AuthType = Auth["type"];

const TYPES: Array<{ value: AuthType; label: string }> = [
  { value: "none", label: "Aucune" },
  { value: "basic", label: "Basic (identifiant et mot de passe)" },
  { value: "bearer", label: "Bearer (jeton)" },
  { value: "apiKey", label: "Clé d'API" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

interface Props {
  auth: Auth;
  onChange: (auth: Auth) => void;
}

export function AuthEditor({ auth, onChange }: Props) {
  const changeType = (type: AuthType) => {
    switch (type) {
      case "basic":
        return onChange({ type: "basic", username: "", password: "" });
      case "bearer":
        return onChange({ type: "bearer", token: "" });
      case "apiKey":
        return onChange({ type: "apiKey", key: "X-API-Key", value: "", in: "header" });
      default:
        return onChange({ type: "none" });
    }
  };

  return (
    <div className="space-y-4">
      <Select value={auth.type} onValueChange={(value) => changeType(value as AuthType)}>
        <SelectTrigger className="w-72" aria-label="Type d'authentification">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {auth.type === "none" && <p className="text-sm text-muted-foreground">Aucune authentification n&apos;est ajoutée.</p>}

      {auth.type === "basic" && (
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="Identifiant">
            <Input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} spellCheck={false} autoComplete="off" />
          </Field>
          <Field label="Mot de passe">
            <Input value={auth.password} onChange={(e) => onChange({ ...auth, password: e.target.value })} spellCheck={false} autoComplete="off" placeholder="{{password}}" />
          </Field>
        </div>
      )}

      {auth.type === "bearer" && (
        <div className="max-w-xl">
          <Field label="Jeton">
            <Input value={auth.token} onChange={(e) => onChange({ ...auth, token: e.target.value })} spellCheck={false} autoComplete="off" placeholder="{{api_token}}" className="font-mono" />
          </Field>
        </div>
      )}

      {auth.type === "apiKey" && (
        <div className="grid max-w-xl gap-3 sm:grid-cols-3">
          <Field label="Nom">
            <Input value={auth.key} onChange={(e) => onChange({ ...auth, key: e.target.value })} spellCheck={false} className="font-mono" />
          </Field>
          <Field label="Valeur">
            <Input value={auth.value} onChange={(e) => onChange({ ...auth, value: e.target.value })} spellCheck={false} autoComplete="off" placeholder="{{api_key}}" className="font-mono" />
          </Field>
          <Field label="Envoyée dans">
            <Select value={auth.in} onValueChange={(value) => onChange({ ...auth, in: value as "header" | "query" })}>
              <SelectTrigger aria-label="Emplacement de la clé">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">En-tête</SelectItem>
                <SelectItem value="query">Paramètre d&apos;URL</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      {auth.type !== "none" && (
        <p className="max-w-xl text-sm text-muted-foreground">
          Astuce : mets le secret dans une variable d&apos;environnement marquée « secret » et écris ici {"{{nom_de_la_variable}}"}, plutôt que la valeur en clair.
        </p>
      )}
    </div>
  );
}