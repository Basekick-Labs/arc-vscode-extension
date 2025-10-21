# Dark Mode Support - Implementation Guide

## Overview

The Arc VS Code Extension now has complete dark mode support that automatically adapts to the user's VS Code theme (light, dark, or high contrast).

## Implementation Details

All webviews in the extension use **VS Code CSS Variables** which automatically change based on the active theme. This ensures consistent styling across all VS Code themes without any manual configuration.

---

## CSS Variables Used

### Core Colors

| Variable | Purpose | Example Values |
|----------|---------|----------------|
| `--vscode-foreground` | Primary text color | Light: `#000000`, Dark: `#cccccc` |
| `--vscode-background` | Main background | Light: `#ffffff`, Dark: `#1e1e1e` |
| `--vscode-editor-background` | Editor background | Light: `#ffffff`, Dark: `#1e1e1e` |

### UI Elements

| Variable | Purpose |
|----------|---------|
| `--vscode-panel-border` | Borders and dividers |
| `--vscode-button-background` | Button backgrounds |
| `--vscode-button-foreground` | Button text |
| `--vscode-button-hoverBackground` | Button hover state |
| `--vscode-list-hoverBackground` | List/table row hover |
| `--vscode-editor-lineHighlightBackground` | Highlighted areas |

### Text & Code

| Variable | Purpose |
|----------|---------|
| `--vscode-font-family` | UI font |
| `--vscode-editor-font-family` | Code font (monospace) |
| `--vscode-textCodeBlock-background` | Code block background |
| `--vscode-descriptionForeground` | Secondary text |
| `--vscode-textLink-foreground` | Links and accents |

### Status Colors

| Variable | Purpose |
|----------|---------|
| `--vscode-notificationsWarningIcon-foreground` | Warnings |
| `--vscode-errorForeground` | Errors |
| `--vscode-inputValidation-warningBackground` | Warning backgrounds |
| `--vscode-inputValidation-errorBackground` | Error backgrounds |

---

## Updated Components

### 1. Query Results View
**File:** `src/views/queryResultsView.ts`

**Dark Mode Features:**
- Tables with theme-aware borders and hover effects
- Chart.js integration with dynamic color reading
- Export buttons with proper contrast
- Warning messages with theme colors

**Chart.js Integration:**
```javascript
// Get VS Code theme colors dynamically
const computedStyle = getComputedStyle(document.body);
const foregroundColor = computedStyle.getPropertyValue('--vscode-foreground').trim() || '#cccccc';
const borderColor = computedStyle.getPropertyValue('--vscode-panel-border').trim() || '#454545';

// Apply to Chart.js
chartInstance = new Chart(ctx, {
    options: {
        plugins: {
            title: { color: foregroundColor },
            legend: { labels: { color: foregroundColor } }
        },
        scales: {
            x: {
                ticks: { color: foregroundColor },
                grid: { color: borderColor }
            },
            y: {
                ticks: { color: foregroundColor },
                grid: { color: borderColor }
            }
        }
    }
});
```

**Why this approach?**
Chart.js cannot directly use CSS variables in its config, so we:
1. Read the computed CSS variable values using `getComputedStyle()`
2. Extract the actual color values
3. Pass them to Chart.js config
4. Falls back to sensible defaults for dark mode if CSS vars aren't found

### 2. Notebook Editor
**File:** `src/views/notebookEditor.ts`

**Dark Mode Features:**
- Cell borders and backgrounds adapt to theme
- Markdown and SQL cells with proper contrast
- Buttons and inputs with theme colors
- Output tables with alternating row highlights
- Variables section with theme-aware styling

**Key CSS:**
```css
.cell {
    border: 1px solid var(--vscode-panel-border);
    background-color: var(--vscode-editor-background);
}

.cell-toolbar {
    background-color: var(--vscode-editor-lineHighlightBackground);
}

textarea {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
}

textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
}
```

### 3. Alert Details View
**File:** `src/commands/arcCommands.ts` (showAlertDetails method)

**Dark Mode Features:**
- Pre-formatted text blocks with proper backgrounds
- Strong text with accent colors
- Proper padding and borders

**Enhanced Styling:**
```css
body {
    background-color: var(--vscode-editor-background);
    color: var(--vscode-foreground);
}

pre {
    background-color: var(--vscode-textCodeBlock-background);
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
}

strong {
    color: var(--vscode-textLink-foreground);
}
```

---

## Testing Dark Mode

### Manual Testing

**1. Switch to Dark Theme:**
```
VS Code → Preferences → Color Theme → Dark+ (default dark)
```

**2. Test Components:**
- Execute a query → Check query results view
- Open a notebook → Check cell rendering
- Create an alert → Check alert details view
- View charts → Check chart text/grid visibility

**3. Switch to Light Theme:**
```
VS Code → Preferences → Color Theme → Light+ (default light)
```

**4. Verify:**
- All text is readable
- No hardcoded colors visible
- Buttons have proper contrast
- Charts adapt to theme

### High Contrast Testing

**Test High Contrast Themes:**
```
VS Code → Preferences → Color Theme
- High Contrast (light)
- High Contrast (dark)
```

All components should work correctly with increased contrast.

---

## Browser Compatibility

The extension uses standard CSS custom properties (CSS variables) which are supported in:
- All VS Code webviews (Chromium-based)
- Modern browsers (Chrome, Firefox, Safari, Edge)

No polyfills or fallbacks needed for VS Code environment.

---

## Chart Color Palette

We use a vibrant color palette that works well in both light and dark themes:

```javascript
const colors = [
    '#4dc9f6',  // Cyan
    '#f67019',  // Orange
    '#f53794',  // Pink
    '#537bc4',  // Blue
    '#acc236'   // Green
];
```

These colors were chosen because:
- High contrast against both light and dark backgrounds
- Distinguishable from each other
- Colorblind-friendly (to an extent)
- Professional and modern appearance

---

## Best Practices

### ✅ Do's

**1. Always use VS Code CSS variables:**
```css
/* Good */
color: var(--vscode-foreground);
background: var(--vscode-editor-background);

/* Bad */
color: #cccccc;
background: #1e1e1e;
```

**2. Provide fallbacks for dynamic colors:**
```javascript
const color = computedStyle.getPropertyValue('--vscode-foreground').trim() || '#cccccc';
```

**3. Test in multiple themes:**
- Dark themes (Dark+, One Dark Pro, etc.)
- Light themes (Light+, GitHub Light, etc.)
- High contrast themes

**4. Use semantic variables:**
```css
/* Use semantic names that adapt */
border: 1px solid var(--vscode-panel-border);

/* Instead of direct colors */
border: 1px solid #454545;
```

### ❌ Don'ts

**1. Don't hardcode colors:**
```css
/* Bad */
.element {
    color: #ffffff;
    background: #000000;
}
```

**2. Don't use theme-specific logic:**
```javascript
// Bad - fragile and incomplete
if (theme === 'dark') {
    color = '#cccccc';
} else {
    color = '#000000';
}

// Good - automatic
color = getComputedStyle(document.body)
    .getPropertyValue('--vscode-foreground');
```

**3. Don't forget hover states:**
```css
/* Good - includes hover */
button {
    background: var(--vscode-button-background);
}
button:hover {
    background: var(--vscode-button-hoverBackground);
}
```

**4. Don't use opacity for disabled states:**
```css
/* Bad - colors may not work in all themes */
.disabled {
    opacity: 0.5;
}

/* Better - use semantic color */
.disabled {
    color: var(--vscode-disabledForeground);
}
```

---

## Common Issues & Solutions

### Issue 1: Chart.js colors not updating

**Problem:** Chart text appears with wrong color in dark mode.

**Solution:** Chart.js doesn't support CSS variables directly. Use computed styles:

```javascript
// Wrong
color: 'var(--vscode-foreground)'  // Won't work

// Correct
const foregroundColor = getComputedStyle(document.body)
    .getPropertyValue('--vscode-foreground').trim();
color: foregroundColor  // Works!
```

### Issue 2: Borders invisible in some themes

**Problem:** Borders not visible in certain themes.

**Solution:** Always use `--vscode-panel-border` instead of transparency:

```css
/* Wrong */
border: 1px solid rgba(255, 255, 255, 0.1);

/* Correct */
border: 1px solid var(--vscode-panel-border);
```

### Issue 3: Input fields hard to see

**Problem:** Input elements blend into background.

**Solution:** Use input-specific variables:

```css
input, textarea {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
}

input:focus, textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
}
```

### Issue 4: Button contrast issues

**Problem:** Buttons hard to see or click.

**Solution:** Use all button states:

```css
button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
}

button:hover {
    background-color: var(--vscode-button-hoverBackground);
}

button:active {
    opacity: 0.8;
}

button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
```

---

## Future Enhancements

### Potential Improvements

1. **Theme-aware chart colors:**
   - Detect if dark/light theme
   - Use different color palettes accordingly
   - Improve contrast for specific themes

2. **Custom theme support:**
   - Allow users to customize chart colors
   - Settings for color preferences
   - Color picker integration

3. **Accessibility:**
   - WCAG AAA contrast ratios
   - Colorblind-friendly palettes
   - Pattern fills for charts (not just colors)

4. **Animation:**
   - Smooth transitions when switching themes
   - Fade-in effects for webviews

---

## Testing Checklist

When adding new webviews or updating existing ones:

- [ ] All text uses `var(--vscode-foreground)` or semantic variant
- [ ] All backgrounds use `var(--vscode-*-background)` variables
- [ ] Borders use `var(--vscode-panel-border)` or semantic variant
- [ ] Buttons include `:hover` and `:active` states
- [ ] Input fields use input-specific variables
- [ ] Code blocks use `var(--vscode-textCodeBlock-background)`
- [ ] Charts use computed color values (not CSS variables directly)
- [ ] Tested in Dark+ theme
- [ ] Tested in Light+ theme
- [ ] Tested in at least one High Contrast theme
- [ ] No console errors in webview
- [ ] All interactive elements have proper focus indicators

---

## Reference: All VS Code CSS Variables

### Layout
```css
--vscode-font-family
--vscode-font-weight
--vscode-font-size
--vscode-foreground
--vscode-background
--vscode-focusBorder
--vscode-disabledForeground
```

### Editor
```css
--vscode-editor-foreground
--vscode-editor-background
--vscode-editor-font-family
--vscode-editor-font-weight
--vscode-editor-lineHighlightBackground
--vscode-editor-selectionBackground
--vscode-editor-inactiveSelectionBackground
```

### Buttons
```css
--vscode-button-foreground
--vscode-button-background
--vscode-button-hoverBackground
--vscode-button-secondaryForeground
--vscode-button-secondaryBackground
--vscode-button-secondaryHoverBackground
```

### Inputs
```css
--vscode-input-foreground
--vscode-input-background
--vscode-input-border
--vscode-inputOption-activeBorder
--vscode-inputValidation-errorBackground
--vscode-inputValidation-errorBorder
--vscode-inputValidation-warningBackground
--vscode-inputValidation-warningBorder
```

### Lists
```css
--vscode-list-activeSelectionBackground
--vscode-list-activeSelectionForeground
--vscode-list-hoverBackground
--vscode-list-hoverForeground
--vscode-list-focusBackground
```

### Panels
```css
--vscode-panel-background
--vscode-panel-border
--vscode-panelTitle-activeForeground
--vscode-panelTitle-inactiveForeground
```

### Text
```css
--vscode-textLink-foreground
--vscode-textLink-activeForeground
--vscode-textCodeBlock-background
--vscode-textPreformat-foreground
--vscode-descriptionForeground
```

### Status
```css
--vscode-errorForeground
--vscode-warningForeground
--vscode-notificationsErrorIcon-foreground
--vscode-notificationsWarningIcon-foreground
--vscode-notificationsInfoIcon-foreground
```

---

## Conclusion

The Arc VS Code Extension now provides a seamless dark mode experience that:

✅ Automatically adapts to any VS Code theme
✅ Maintains consistency across all components
✅ Provides proper contrast and readability
✅ Works with light, dark, and high contrast themes
✅ Requires zero configuration from users

All webviews use VS Code's native CSS variables, ensuring they always match the user's chosen theme and providing a native VS Code experience.

---

*Last updated: October 2024*
*Extension version: 0.1.4*
