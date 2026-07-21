# Dialog wheel and trackpad scrolling

Desktop Material's floating dialogs accept vertical mouse-wheel and trackpad
gestures anywhere over their scrollable content. Users no longer need to aim at
the narrow scrollbar gutter.

## Behavior

The shared dialog shell examines the event target and walks toward the owning
dialog. It scrolls the nearest element that has remaining vertical range:

- a nested list, editor, text area, or other scroll region consumes its own
  range first;
- at a nested region's top or bottom edge, the outer dialog body can consume
  the next gesture;
- a child control that prevents the wheel event retains ownership;
- `Ctrl`+wheel is left untouched for the app's zoom behavior; and
- wheel interaction with a background floating dialog requests that dialog be
  brought to the front through the existing popup stack callback.

Pixel, line, and page wheel delta modes are normalized before changing the
bounded `scrollTop`. The router never searches beyond the current dialog.

## Configuration and accessibility

There is no user setting. The behavior follows every shared dialog, including
narrow and short responsive layouts. Keyboard scrolling, focus trapping,
Escape/close ownership, reduced motion, and the native semantic dialog tree are
unchanged.

## Failure and security boundaries

Gestures with no vertical delta, a prevented default, no in-dialog target, or
no owner with remaining range are ignored. The implementation does not emit
synthetic input, focus another application, inspect content outside the dialog,
or scroll the main repository workspace behind the chosen floating surface.

## Verification

Focused component coverage starts gestures on an ordinary descendant, proves a
nested region wins while it has range and chains at its edge, preserves a
preventing child and `Ctrl`+wheel, and verifies the background panel requests
front. Existing dialog dismissal, responsive, and shared-shell style contracts
remain in the combined local gate recorded in `HANDOFF.md`.
