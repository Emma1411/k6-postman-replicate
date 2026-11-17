"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { useAppDispatch, useAppSelector } from "@/client/store/hooks";
import { VariableNameSchema, type Environment } from "@/shared/schemas";
import {
  chooseEnvironment,
  newEnvironment,
  removeEnvironment,
  upsertEnvironment,
} from "../environments-slice";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EnvironmentDialog({ open, onOpenChange }: Props) {
  const dispatch = useAppDispatch();
  const { items, selectedId, error } = useAppSelector((s) => s.environments);
  const [editing, setEditing] = useState<Environment | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const edit = (next: Environment) => {
    setEditing(next);
    setMessage(null);
  };

  const updateVariable = (
    index: number,
    patch: Partial<Environment["variables"][number]>,
  ) =>
    editing &&
    edit({
      ...editing,
      variables: editing.variables.map((v, i) =>
        i === index ? { ...v, ...patch } : v,
      ),
    });

  async function save() {
    if (!editing) return;
    const isNew = !items.some((e) => e.id === editing.id);
    try {
      await dispatch(upsertEnvironment(editing)).unwrap();
      if (isNew && selectedId === null)
        await dispatch(chooseEnvironment(editing.id)).unwrap();
      setMessage("Enregistré dans ce navigateur.");
    } catch {
      setMessage(null);
    }
  }

  async function remove() {
    if (!editing) return;
    await dispatch(removeEnvironment(editing.id));
    setEditing(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Environnements et variables</DialogTitle>
          <DialogDescription>
            Écris {"{{nom}}"} dans l&apos;adresse, les en-têtes ou le corps : la
            valeur de l&apos;environnement choisi la remplace à l&apos;envoi.
            Les environnements restent dans ton navigateur.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          <div className="space-y-2">
            {items.map((env) => (
              <button
                key={env.id}
                type="button"
                onClick={() => edit(structuredClone(env))}
                className={cn(
                  "block w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  editing?.id === env.id && "bg-accent",
                )}
              >
                {env.name}
              </button>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-1"
              onClick={() => edit(newEnvironment("Nouvel environnement"))}
            >
              <Plus className="size-4" aria-hidden />
              Nouvel environnement
            </Button>
          </div>

          <div className="space-y-4">
            {!editing ? (
              <p className="text-sm text-muted-foreground">
                {items.length === 0
                  ? "Crée un premier environnement, par exemple « Production » avec une variable base_url."
                  : "Choisis un environnement à modifier."}
              </p>
            ) : (
              <>
                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Nom</span>
                  <Input
                    value={editing.name}
                    onChange={(e) => edit({ ...editing, name: e.target.value })}
                  />
                </label>

                <div className="space-y-2">
                  <div
                    className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-1 text-xs text-muted-foreground"
                    aria-hidden
                  >
                    <span>Nom de la variable</span>
                    <span>Valeur</span>
                    <span>Secret</span>
                    <span className="w-8" />
                  </div>
                  {editing.variables.map((variable, i) => {
                    const invalid =
                      variable.key !== "" &&
                      !VariableNameSchema.safeParse(variable.key).success;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                          <Input
                            value={variable.key}
                            onChange={(e) =>
                              updateVariable(i, { key: e.target.value })
                            }
                            aria-label={`Nom de la variable ${i + 1}`}
                            aria-invalid={invalid}
                            placeholder="base_url"
                            spellCheck={false}
                            className={cn(
                              "font-mono",
                              invalid && "border-destructive",
                            )}
                          />
                          <Input
                            type={variable.secret ? "password" : "text"}
                            value={variable.value}
                            onChange={(e) =>
                              updateVariable(i, { value: e.target.value })
                            }
                            aria-label={`Valeur de la variable ${i + 1}`}
                            autoComplete="off"
                            spellCheck={false}
                            className="font-mono"
                          />
                          <Checkbox
                            checked={variable.secret}
                            onCheckedChange={(checked) =>
                              updateVariable(i, { secret: checked === true })
                            }
                            aria-label={`Variable ${i + 1} secrète`}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              edit({
                                ...editing,
                                variables: editing.variables.filter(
                                  (_, j) => j !== i,
                                ),
                              })
                            }
                            aria-label={`Supprimer la variable ${i + 1}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                        {invalid && (
                          <p className="text-xs text-destructive-text">
                            Nom invalide : lettres, chiffres, « _ », « . » ou «
                            - », en commençant par une lettre ou « _ ».
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      edit({
                        ...editing,
                        variables: [
                          ...editing.variables,
                          { key: "", value: "", enabled: true, secret: false },
                        ],
                      })
                    }
                  >
                    <Plus className="size-4" aria-hidden />
                    Ajouter une variable
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Une variable « secret » est masquée à l&apos;écran et vidée
                  dans les exports de ton espace de travail.
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={save}>
                    Enregistrer
                  </Button>
                  {items.some((e) => e.id === editing.id) && (
                    <Button type="button" variant="outline" onClick={remove}>
                      Supprimer
                    </Button>
                  )}
                  {message && (
                    <span role="status" className="text-sm text-success">
                      {message}
                    </span>
                  )}
                  {error && (
                    <span
                      role="alert"
                      className="text-sm text-destructive-text"
                    >
                      {error}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
