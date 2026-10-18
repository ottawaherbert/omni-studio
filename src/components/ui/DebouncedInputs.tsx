import React, { useState, useEffect, useRef } from 'react';

interface DebouncedTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export function DebouncedTextarea({ value, onChange, debounceMs = 500, ...props }: DebouncedTextareaProps) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<any>(null);

  // Ensure localValue syncs if external value changes (e.g. from another client or initialization)
  // But ONLY if we aren't currently waiting for a debounce, otherwise it overwrites typing!
  useEffect(() => {
    if (!timeoutRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
      timeoutRef.current = null;
    }, debounceMs);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      onChange(localValue);
    }
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  return (
    <textarea 
      {...props} 
      value={localValue} 
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}

interface DebouncedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export function DebouncedInput({ value, onChange, debounceMs = 500, ...props }: DebouncedInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<any>(null);

  useEffect(() => {
    if (!timeoutRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
      timeoutRef.current = null;
    }, debounceMs);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      onChange(localValue);
    }
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  return (
    <input 
      {...props} 
      value={localValue} 
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
