import * as React from "react";
import { addDays, format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function DateRangePicker({
  className,
  date,
  setDate,
  placeholder = "Pick a date range",
  presets = true,
  ...props
}) {
  const [internalDate, setInternalDate] = React.useState({
    from: date?.from || undefined,
    to: date?.to || undefined,
  });

  // Sync internal state with external prop
  React.useEffect(() => {
    if (date?.from !== internalDate.from || date?.to !== internalDate.to) {
      setInternalDate({
        from: date?.from || undefined,
        to: date?.to || undefined,
      });
    }
  }, [date]);

  const handleDateChange = (newDate) => {
    setInternalDate(newDate);
    if (setDate) {
      setDate(newDate);
    }
  };

  const isPresetSelected = (preset) => {
    if (!internalDate?.from || !internalDate?.to) return false;
    return (
      internalDate.from.toDateString() === preset.range.from.toDateString() &&
      internalDate.to.toDateString() === preset.range.to.toDateString()
    );
  };

  const presetRanges = [
    {
      label: "Today",
      range: {
        from: new Date(),
        to: new Date(),
      },
    },
    {
      label: "Yesterday",
      range: {
        from: addDays(new Date(), -1),
        to: addDays(new Date(), -1),
      },
    },
    {
      label: "Last 7 days",
      range: {
        from: addDays(new Date(), -6),
        to: new Date(),
      },
    },
    {
      label: "Last 30 days",
      range: {
        from: addDays(new Date(), -29),
        to: new Date(),
      },
    },
    {
      label: "This month",
      range: {
        from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        to: new Date(),
      },
    },
    {
      label: "Last month",
      range: {
        from: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
        to: new Date(new Date().getFullYear(), new Date().getMonth(), 0),
      },
    },
  ];

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-full justify-start text-left font-normal",
              !internalDate?.from && "text-muted-foreground"
            )}
            {...props}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {internalDate?.from ? (
              internalDate.to ? (
                <>
                  {format(internalDate.from, "MMM dd, y")} -{" "}
                  {format(internalDate.to, "MMM dd, y")}
                </>
              ) : (
                format(internalDate.from, "MMM dd, y")
              )
            ) : (
              <span>{placeholder}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" side="bottom" sideOffset={4}>
          <div className="flex flex-col sm:flex-row">
            {/* Preset ranges sidebar */}
            {presets && (
              <div className="border-b sm:border-b-0 sm:border-r border-border bg-muted/50">
                <div className="p-3">
                  <div className="text-sm font-medium text-foreground mb-2">Quick select</div>
                  <div className="flex flex-row sm:flex-col gap-1">
                    {presetRanges.map((preset) => (
                      <Button
                        key={preset.label}
                        variant={isPresetSelected(preset) ? "default" : "ghost"}
                        className={cn(
                          "justify-start text-sm font-normal h-auto p-2 hover:bg-accent hover:text-accent-foreground whitespace-nowrap",
                          isPresetSelected(preset) && "bg-primary text-primary-foreground"
                        )}
                        onClick={() => handleDateChange(preset.range)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            {/* Calendar */}
            <div className="p-3">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={internalDate?.from}
                selected={internalDate}
                onSelect={handleDateChange}
                numberOfMonths={2}
                className="rounded-md"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
} 