import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const EVEAgentRequesterModule = buildModule("EVEAgentRequesterModule", (m) => {
  const deployer = m.getAccount(0);

  const agentPlatform = m.getParameter(
    "agentPlatform",
    "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776"
  );
  const eveAgentId = m.getParameter("eveAgentId", 12847293847561029384n);
  const systemPrompt = m.getParameter(
    "systemPrompt",
    "You are Agent E.V.E, a concise SAS governance auditor. Return operational findings, risks, and recommended admin actions as JSON."
  );

  const requester = m.contract("EVEAgentRequester", [
    deployer,
    agentPlatform,
    eveAgentId,
    systemPrompt,
  ]);

  return { requester };
});

export default EVEAgentRequesterModule;
