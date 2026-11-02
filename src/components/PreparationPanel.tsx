import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { LabeledSelect } from '@/components/HikeSelects';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EXPENSE_LABELS, tripBudget } from '../../shared/budget';
import { checklistSuggestions } from '../../shared/checklist';
import type { Expense, Trip } from '../../shared/schema';

const euros = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function BudgetTab({ trip, onSave }: { trip: Trip; onSave: (trip: Trip) => void }) {
  const budget = tripBudget(trip);
  const expenses = trip.expenses ?? [];
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Expense['category']>('energy');

  const add = (event: FormEvent) => {
    event.preventDefault();
    const expense = {
      id: crypto.randomUUID(),
      label: label.trim() || EXPENSE_LABELS[category],
      amount: Number(amount),
      category,
    };
    onSave({ ...trip, expenses: [...expenses, expense] });
    setLabel('');
    setAmount('');
  };

  return (
    <div className="grid gap-3">
      <p className="text-lg font-semibold tabular-nums">{euros.format(budget.total)}</p>
      {budget.byCategory.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {budget.byCategory.map((line) => (
            <li key={line.category} className="flex justify-between gap-3">
              <span>{EXPENSE_LABELS[line.category]}</span>
              <span className="tabular-nums">{euros.format(line.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {budget.nightsWithoutPrice > 0 && (
        <p className="text-sm text-muted-foreground">
          {budget.nightsWithoutPrice > 1
            ? `${budget.nightsWithoutPrice} nuits sans prix`
            : 'Une nuit sans prix'}{' '}
          : renseignez le prix dans la fiche de l'hébergement.
        </p>
      )}
      {expenses.length > 0 && (
        <ul className="grid gap-1 border-t pt-2 text-sm">
          {expenses.map((expense) => (
            <li key={expense.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{expense.label}</span>
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                {euros.format(expense.amount)}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Supprimer ${expense.label}`}
                  onClick={() =>
                    onSave({
                      ...trip,
                      expenses: expenses.filter(({ id }) => id !== expense.id),
                    })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid grid-cols-2 gap-2 border-t pt-3">
        <LabeledSelect
          id="expense-category"
          label="Poste"
          value={category}
          options={EXPENSE_LABELS}
          onChange={setCategory}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="expense-amount">Montant (€)</Label>
          <Input
            id="expense-amount"
            type="number"
            min={0}
            step="any"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="col-span-2 flex items-end gap-2">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="expense-label">Libellé</Label>
            <Input
              id="expense-label"
              placeholder="Péage A43"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            <Plus aria-hidden />
            Ajouter
          </Button>
        </div>
      </form>
    </div>
  );
}

function ChecklistTab({ trip, onSave }: { trip: Trip; onSave: (trip: Trip) => void }) {
  const items = trip.checklist ?? [];
  const suggestions = checklistSuggestions(trip);
  const [label, setLabel] = useState('');

  const add = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    onSave({
      ...trip,
      checklist: [...items, { id: crypto.randomUUID(), label: trimmed, done: false }],
    });
    setLabel('');
  };

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        {items.filter(({ done }) => done).length} sur {items.length} fait
      </p>
      {suggestions.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => onSave({ ...trip, checklist: [...items, ...suggestions] })}
        >
          <Plus aria-hidden />
          Ajouter {suggestions.length} suggestions
        </Button>
      )}
      {items.length > 0 && (
        <ul className="grid gap-1.5 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <Checkbox
                id={`check-${item.id}`}
                checked={item.done}
                onCheckedChange={(checked) =>
                  onSave({
                    ...trip,
                    checklist: items.map((candidate) =>
                      candidate.id === item.id
                        ? { ...candidate, done: checked === true }
                        : candidate,
                    ),
                  })
                }
              />
              <Label htmlFor={`check-${item.id}`} className="min-w-0 flex-1 font-normal">
                {item.label}
              </Label>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Retirer ${item.label}`}
                onClick={() =>
                  onSave({
                    ...trip,
                    checklist: items.filter(({ id }) => id !== item.id),
                  })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <Input
          aria-label="Nouvelle tâche"
          placeholder="Nouvelle tâche"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Button type="submit" variant="outline" size="icon" aria-label="Ajouter la tâche">
          <Plus aria-hidden />
        </Button>
      </form>
    </div>
  );
}

export function PreparationPanel({ trip, onSave }: { trip: Trip; onSave: (trip: Trip) => void }) {
  return (
    <Card>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
          <CardHeader className="flex-1">
            <CardTitle className="text-base">Préparation</CardTitle>
          </CardHeader>
          <ChevronDown
            className="mr-6 size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <Tabs defaultValue="budget">
              <TabsList>
                <TabsTrigger value="budget">Budget</TabsTrigger>
                <TabsTrigger value="checklist">Checklist</TabsTrigger>
              </TabsList>
              <TabsContent value="budget">
                <BudgetTab trip={trip} onSave={onSave} />
              </TabsContent>
              <TabsContent value="checklist">
                <ChecklistTab trip={trip} onSave={onSave} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
