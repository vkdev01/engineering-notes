import type { ComponentType } from "react";
import Scorecard from "./Scorecard";
import ContextBudget from "./ContextBudget";
import Checklist from "./Checklist";

/**
 * Exercise registry.
 * Add a component here and reference it from markdown with:
 *   :::exercise[Exercise 02.1]{id="scorecard"}
 * Props in the braces are passed through as strings.
 */
export const EXERCISES: Record<string, ComponentType<Record<string, string>>> = {
  scorecard: Scorecard as unknown as ComponentType<Record<string, string>>,
  budget: ContextBudget as unknown as ComponentType<Record<string, string>>,
  checklist: Checklist as unknown as ComponentType<Record<string, string>>,
};

export const EXERCISE_IDS = Object.keys(EXERCISES);
