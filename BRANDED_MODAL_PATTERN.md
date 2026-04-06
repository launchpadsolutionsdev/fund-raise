# Branded Modal / Popup Pattern

Use this pattern for **all** user-facing popups, alerts, confirmations, and error messages across the platform. **Never use `alert()`, `confirm()`, or `prompt()`** — always use this branded modal instead.

## HTML Markup

```html
<!-- Branded modal -->
<div class="rpt-modal-overlay" id="my-modal" onclick="if(event.target===this)closeMyModal()">
    <div class="rpt-modal">
        <div class="rpt-modal-icon"><i class="bi bi-exclamation-triangle"></i></div>
        <div class="rpt-modal-title">Modal Title</div>
        <div class="rpt-modal-text">Modal description text goes here.</div>
        <button class="rpt-modal-btn" onclick="closeMyModal()">OK</button>
    </div>
</div>
```

## Required CSS

```css
.rpt-modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.4);z-index:10000;align-items:center;justify-content:center;backdrop-filter:blur(2px)}
.rpt-modal-overlay.active{display:flex}
.rpt-modal{background:white;border-radius:16px;padding:32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.2);text-align:center;animation:rpt-modal-in .2s ease}
@keyframes rpt-modal-in{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
.rpt-modal-icon{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#003B5C,#0072BB);display:inline-flex;align-items:center;justify-content:center;font-size:24px;color:white;margin-bottom:16px}
.rpt-modal-title{font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:8px}
.rpt-modal-text{font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:24px}
.rpt-modal-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--color-brand-blue);color:white;font-family:'Poppins',sans-serif;font-size:14px;font-weight:600;padding:10px 36px;border-radius:10px;border:none;cursor:pointer;transition:background .15s}
.rpt-modal-btn:hover{background:var(--color-brand-navy)}
```

## JavaScript — Show / Close

```js
// Show the modal
function showMyModal(title, text, icon) {
    var modal = document.getElementById('my-modal');
    document.getElementById('my-modal-title').textContent = title;  // or set innerHTML for rich content
    document.getElementById('my-modal-text').textContent = text;
    if (icon) document.getElementById('my-modal-icon').innerHTML = '<i class="bi ' + icon + '"></i>';
    modal.classList.add('active');
}

// Close the modal
function closeMyModal() {
    document.getElementById('my-modal').classList.remove('active');
}
```

## Usage Examples

### Error message (replaces `alert()`)
```js
showMyModal('Error Loading Data', 'Something went wrong. Please try again.', 'bi-exclamation-triangle');
```

### Informational message
```js
showMyModal('Fiscal Year Required', 'Please select a Fiscal Year from the picker to generate this report.', 'bi-calendar3');
```

### Success confirmation
```js
showMyModal('Export Complete', 'Your report has been downloaded.', 'bi-check-circle');
```

## Common Icons (Bootstrap Icons)

| Context | Icon class |
|---------|-----------|
| Error / Warning | `bi-exclamation-triangle` |
| Info / Prompt | `bi-calendar3`, `bi-info-circle` |
| Success | `bi-check-circle` |
| Delete / Danger | `bi-trash` |
| Question | `bi-question-circle` |

## Design Notes

- **Backdrop click closes** the modal (`onclick="if(event.target===this)..."` on overlay)
- **Scale-in animation** from 0.95 to 1.0 over 0.2s
- **Blur backdrop** with `backdrop-filter:blur(2px)`
- **z-index: 10000** — sits above all other content including loading bars
- **Brand gradient icon** uses navy-to-blue (`#003B5C` to `#0072BB`)
- **Button uses `--color-brand-blue`** with hover state `--color-brand-navy`
- Max width 420px, responsive at 90% on small screens

## Multi-Button Variant

For confirm/cancel dialogs, add a secondary button:

```html
<div style="display:flex;gap:10px;justify-content:center;">
    <button class="rpt-modal-btn" style="background:var(--color-background-secondary);color:var(--color-text-primary);" onclick="closeMyModal()">Cancel</button>
    <button class="rpt-modal-btn" onclick="handleConfirm()">Confirm</button>
</div>
```
