import re

with open('client/src/App.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

out_lines = []
in_buy_modal = False
in_flight_modal = False
in_jail_modal = False
buy_modal_lines = []
flight_modal_lines = []
jail_modal_lines = []
capture_depth = 0

for i, line in enumerate(lines):
    if '{/* Property Modal (Buy or Upgrade) */}' in line:
        in_buy_modal = True
    elif '{/* Flight Terminal Modal */}' in line:
        in_flight_modal = True
    elif '{/* Jail Decision Modal */}' in line:
        in_jail_modal = True
    elif in_buy_modal and '{/* Debt Resolution Slide */}' in line:
        in_buy_modal = False
        out_lines.append(line)
        continue
    elif in_flight_modal and '{/* Card logic is now handled in Board.tsx center area */}' in line:
        in_flight_modal = False
        out_lines.append(line)
        continue
    elif in_jail_modal and '{/* Bankrupt Overlay */}' in line:
        in_jail_modal = False
        out_lines.append(line)
        continue

    if in_buy_modal:
        buy_modal_lines.append(line)
    elif in_flight_modal:
        flight_modal_lines.append(line)
    elif in_jail_modal:
        jail_modal_lines.append(line)
    else:
        out_lines.append(line)

# Now we have the modal lines. Let's process them to strip the outer wrapper.
# For buy modal:
buy_str = "".join(buy_modal_lines)
buy_str = re.sub(r'\{\s*isAwaitingBuy && isMyTurn && buySquare && propState && \(\s*<div className="fixed inset-0 z-\[60\] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">\s*(.*?)\s*</div>\s*\)\s*\}', r'\1', buy_str, flags=re.DOTALL)

# For flight modal:
flight_str = "".join(flight_modal_lines)
flight_str = re.sub(r'\{\s*isAwaitingFlight && isMyTurn && !isAwaitingDebtResolution && \(\s*<div className="fixed inset-0 z-\[60\] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">\s*(.*?)\s*</div>\s*\)\s*\}', r'\1', flight_str, flags=re.DOTALL)

# For jail modal:
jail_str = "".join(jail_modal_lines)
jail_str = re.sub(r'\{\s*isJailDecision && !gameState\.activeCard && \(\s*<div className="fixed inset-0 z-\[65\] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">\s*(.*?)\s*</div>\s*\)\s*\}', r'\1', jail_str, flags=re.DOTALL)

# Add pointer-events-auto to inner divs
buy_str = buy_str.replace('className="bg-[#161622]', 'className="bg-[#161622] pointer-events-auto max-h-[80vh] overflow-y-auto')
flight_str = flight_str.replace('className="bg-[#161622]', 'className="bg-[#161622] pointer-events-auto max-h-[80vh] overflow-y-auto')
jail_str = jail_str.replace('className="bg-[#161622]', 'className="bg-[#161622] pointer-events-auto')

# Assemble centerContent
center_content_code = f"""
  let centerContent: React.ReactNode = null;
  if (isAwaitingBuy && isMyTurn && buySquare && propState) {{
    centerContent = (
      {buy_str.strip()}
    );
  }} else if (isAwaitingFlight && isMyTurn && !isAwaitingDebtResolution) {{
    centerContent = (
      {flight_str.strip()}
    );
  }} else if (isJailDecision && !gameState.activeCard) {{
    centerContent = (
      {jail_str.strip()}
    );
  }}

"""

# Insert centerContent right before return (
final_out = "".join(out_lines)
return_idx = final_out.find('  return (')

# Ensure we are replacing the correct return (the one inside App)
app_idx = final_out.find('export const App: React.FC = () => {')
if app_idx != -1:
    return_idx = final_out.find('  return (', app_idx)

final_out = final_out[:return_idx] + center_content_code + final_out[return_idx:]

# Pass centerContent to Board
final_out = final_out.replace(
    "onRollDice={isMyTurn && !gameState.hasRolled && gameState.state === 'playing' ? handleRollDice : undefined}\n            timeLeft={isMyTurn && activeTab === 'board' ? timeLeft : null}\n          />",
    "onRollDice={isMyTurn && !gameState.hasRolled && gameState.state === 'playing' ? handleRollDice : undefined}\n            timeLeft={isMyTurn && activeTab === 'board' ? timeLeft : null}\n            centerContent={centerContent}\n          />"
)

with open('client/src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(final_out)
