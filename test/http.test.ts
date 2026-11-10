import { expect, test } from "bun:test";
import { endpointOf } from "../src/http.ts";

test("endpointOf: ids, GUIDs, GitLab project paths and Jira keys become placeholders", () => {
  expect(endpointOf("https://dev.azure.com/kms-ch/Clever%20Tax/_apis/git/repositories/453bfed9-acfa-4873-960f-49ed92e5cf7f/pullRequests/27330/threads?api-version=7.1")).toBe(
    "/kms-ch/Clever%20Tax/_apis/git/repositories/:id/pullRequests/:id/threads",
  );
  expect(endpointOf("https://gitlab.example.com/api/v4/projects/group%2Fapp/merge_requests/7/discussions?per_page=100")).toBe("/api/v4/projects/:id/merge_requests/:id/discussions");
  expect(endpointOf("https://gitlab.example.com/api/v4/projects/100/repository/commits/0123456789abcdef0123456789abcdef01234567")).toBe("/api/v4/projects/:id/repository/commits/:id");
  expect(endpointOf("https://jira.example.com/rest/api/2/issue/DEMA-20/comment")).toBe("/rest/api/2/issue/:key/comment");
});
