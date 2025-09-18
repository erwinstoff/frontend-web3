import { ethers } from "hardhat";

async function main() {
  console.log("Deploying ERC2771Forwarder...");

  // Get the contract factory
  const ERC2771Forwarder = await ethers.getContractFactory("ERC2771Forwarder");
  // Deploy the contract with a name argument
  const forwarder = await ERC2771Forwarder.deploy("MyForwarder");
  
  // Wait for deployment to complete
  await forwarder.waitForDeployment();
  
  const address = await forwarder.getAddress();
  
  console.log("ERC2771Forwarder deployed to:", address);
  console.log("Network:", await ethers.provider.getNetwork());
  
  // Verify deployment
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    console.error("❌ Contract deployment failed - no code at address");
    process.exit(1);
  }
  
  console.log("✅ Deployment successful!");
  console.log("Add this address to your .env file:");
  console.log(`TRUSTED_FORWARDER_${(await ethers.provider.getNetwork()).name.toUpperCase()}=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
