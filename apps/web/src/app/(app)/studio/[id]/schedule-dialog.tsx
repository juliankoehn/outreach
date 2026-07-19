"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/calendar";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** ISO timestamp of the current schedule, if any. */
  initial?: string;
  onConfirm(when: Date): void;
}

function nextRoundHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export function ScheduleDialog({ open, onOpenChange, initial, onConfirm }: ScheduleDialogProps) {
  const t = useTranslations();
  const [value, setValue] = useState(() => toLocalInputValue(initial ? new Date(initial) : nextRoundHour()));
  const [error, setError] = useState<string | null>(null);

  // Reset the input to the current initial value whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(toLocalInputValue(initial ? new Date(initial) : nextRoundHour()));
      setError(null);
    }
  }, [open, initial]);

  function handleConfirm() {
    const when = fromLocalInputValue(value);
    if (Number.isNaN(when.getTime())) {
      setError(t("schedule.planInvalid"));
      return;
    }
    if (when.getTime() <= Date.now()) {
      setError(t("schedule.planPast"));
      return;
    }
    setError(null);
    onConfirm(when);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("schedule.planTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            className="border-input bg-transparent flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <p className="text-muted-foreground text-xs">{t("studio.autoPublishNote")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("studio.deleteCancel")}
          </Button>
          <Button onClick={handleConfirm}>{t("schedule.planConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
