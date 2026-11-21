import {describe,it,expect} from "vitest";
import {parseArgs,selectFiles,deriveGates,normalizeAdvisorResult} from "../scripts/homologacao/run.mjs";

describe("homologation orchestration",()=>{
  it("rejects arbitrary phases and mutations disguised as arguments",()=>{
    expect(parseArgs([])).toEqual({phase:"all"});expect(parseArgs(["--phase","h06"])).toEqual({phase:"h06"});
    expect(()=>parseArgs(["--linked"])).toThrow("USAGE");expect(()=>parseArgs(["--phase","production"])).toThrow("USAGE");
  });
  it("places cleanup mutations and proof after functional suites",()=>{
    const files=selectFiles(["documents-official.cleanup-proof","qa-cleanup","stock.authorization","lot-finalization.concurrency"].map(x=>({path:`tests/integration/${x}.test.ts`})) ,"all");
    expect(files.at(-1)).toContain("cleanup-proof");expect(files.at(-2)).toContain("qa-cleanup");expect(files).toHaveLength(4);
  });
  it("requires missing authorization suites and gate-specific HIGH cases",()=>{
    const release={path:"tests/integration/release-highs.authorization.test.ts",status:"PASS",caseNames:["H01 tested","H05 first"]};
    expect(deriveGates([{files:[release]}],"h05").H05.status).toBe("BLOCKED");
    expect(deriveGates([{files:[release]}],"h01").H01.status).toBe("BLOCKED");
    const complete=[release,...["documents-official.authorization","documents-official.cleanup-proof"].map(n=>({path:`tests/integration/${n}.test.ts`,status:"PASS"}))];
    expect(deriveGates([{files:complete}],"h01").H01.status).toBe("PASS");
    complete[1].status="FAIL";expect(deriveGates([{files:complete}],"h01").H01.status).toBe("FAIL");
  });
  it("accepts only CLI's verified empty-result marker, never unexplained empty output",()=>{
    expect(normalizeAdvisorResult({code:0,stdout:"",stderr:"Connecting to local database...\nNo issues found\n"})).toMatchObject({status:"PASS",count:0});
    expect(normalizeAdvisorResult({code:0,stdout:"",stderr:""}).status).toBe("BLOCKED");
    expect(normalizeAdvisorResult({code:1,stdout:"",stderr:"No issues found\n"}).status).toBe("BLOCKED");
    expect(normalizeAdvisorResult({code:0,stdout:JSON.stringify([{name:"example",level:"ERROR"}]),stderr:""}).status).toBe("FAIL");
  });
});
