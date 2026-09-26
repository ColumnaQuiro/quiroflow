// Campaign email metrics, and the webhook that feeds them.
//
// Nothing recorded what happened to an email: runEmailAction posted to Resend
// and discarded the response, so a campaign whose every message hard-bounced
// looked identical to one that landed.
//
// The signature check earns most of this file. The endpoint is
// unauthenticated by nature -- Resend holds no token -- so the signature IS
// the authentication, and without it anyone who learns the URL can write the
// clinic's open rate. A metric nobody can trust is worse than no metric,
// because it still gets acted on.
describe("Email delivery metrics", () => {
  const url = "/api/webhooks/resend";

  it("refuses an unsigned event, and one signed with the wrong secret", () => {
    // An account, because a message belongs to one -- and because these specs
    // may be the first thing to touch a freshly reset database, where
    // "whichever account exists" is none of them.
    cy.seedStaffAccount().then((account) => {
      cy.task("db:seedEmailMessage", {
        accountId: account.accountId,
        providerMessageId: `msg-unsigned-${Date.now()}`,
      }).then((msg: any) => {
        const body = JSON.stringify({
          type: "email.opened",
          created_at: new Date().toISOString(),
          data: { email_id: msg.provider_message_id },
        });

        cy.request({
          method: "POST",
          url,
          body,
          headers: { "content-type": "application/json" },
          failOnStatusCode: false,
        })
          .its("status")
          .should("eq", 401);

        cy.task("db:signResendWebhook", {
          body,
          secret: "whsec_bm90LXRoZS1yaWdodC1zZWNyZXQ=",
        }).then((headers: any) => {
          cy.request({
            method: "POST",
            url,
            body,
            headers: { ...headers, "content-type": "application/json" },
            failOnStatusCode: false,
          })
            .its("status")
            .should("eq", 401);
        });

        // And nothing was recorded by either attempt.
        cy.task("db:emailMessage", {
          providerMessageId: msg.provider_message_id,
        }).then((row: any) => {
          expect(row.first_opened_at, "not opened by an unsigned caller").to.eq(
            null,
          );
          expect(row.open_count).to.eq(0);
        });
      });
    });
  });

  it("records a correctly signed event, and counts a replay only once", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task("db:seedEmailMessage", {
        accountId: account.accountId,
        providerMessageId: `msg-signed-${Date.now()}`,
      }).then((msg: any) => {
        const occurred = new Date().toISOString();
        const body = JSON.stringify({
          type: "email.opened",
          created_at: occurred,
          data: { email_id: msg.provider_message_id },
        });

        cy.task("db:signResendWebhook", { body }).then((headers: any) => {
          const send = () =>
            cy
              .request({
                method: "POST",
                url,
                body,
                headers: { ...headers, "content-type": "application/json" },
              })
              .its("status")
              .should("eq", 200);
          send();
          // Resend retries. The timestamp must not move on a replay, or "when
          // was this first read" becomes "when did the provider last retry".
          send();
        });

        cy.task("db:emailMessage", {
          providerMessageId: msg.provider_message_id,
        }).then((row: any) => {
          expect(row.first_opened_at, "opened").to.not.eq(null);
          expect(new Date(row.first_opened_at).toISOString()).to.eq(
            new Date(occurred).toISOString(),
          );
          // The tally does move -- that is the difference between "how many
          // patients read it" and "how many times it was read".
          expect(row.open_count, "both opens tallied").to.eq(2);
        });
      });
    });
  });

  it("accepts an event for a message it has never seen, rather than retrying forever", () => {
    // An email sent before this table existed, or from another environment
    // sharing the Resend account. Erroring would have the provider retry until
    // it disables the endpoint, and the metrics would stop silently.
    const body = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "msg-never-existed" },
    });
    cy.task("db:signResendWebhook", { body }).then((headers: any) => {
      cy.request({
        method: "POST",
        url,
        body,
        headers: { ...headers, "content-type": "application/json" },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.recorded).to.eq(false);
      });
    });
  });

  it("shows what happened to a campaign, counting patients rather than events", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task("db:createAutomationRule", {
        accountId: account.accountId,
        name: "Boletín",
        triggerEvent: "patient.birthday",
        actions: [],
      }).then((rule: any) => {
        // Four sent: three delivered, of which two opened (one of them twice)
        // and one clicked; one bounced.
        cy.task("db:seedEmailMessage", {
          accountId: account.accountId,
          ruleId: rule.id,
          providerMessageId: `m1-${Date.now()}`,
          delivered: true,
          openCount: 2,
          clicked: true,
        });
        cy.task("db:seedEmailMessage", {
          accountId: account.accountId,
          ruleId: rule.id,
          providerMessageId: `m2-${Date.now()}`,
          delivered: true,
          openCount: 1,
        });
        cy.task("db:seedEmailMessage", {
          accountId: account.accountId,
          ruleId: rule.id,
          providerMessageId: `m3-${Date.now()}`,
          delivered: true,
        });
        cy.task("db:seedEmailMessage", {
          accountId: account.accountId,
          ruleId: rule.id,
          providerMessageId: `m4-${Date.now()}`,
          bounced: true,
        });

        cy.login(account.email, account.password);
        cy.visit("/automations");

        // In the list: the open rate. Two of three DELIVERED opened -- 67 %.
        // Not two of four: an open rate diluted by a message that never
        // arrived measures the address list.
        cy.get(`[data-test="rule-${rule.id}"] [data-test="stat-third"]`).should("have.text", "67 %");

        // In the automation: the rest of it.
        cy.get(`[data-test="rule-${rule.id}"] [data-test="rule-link"]`).click();
        cy.get('[data-test="rule-email-stats"]').within(() => {
          cy.get('[data-test="rule-email-stats-Sent"]').should("contain.text", "4");
          // Three opens happened; two patients opened.
          cy.get('[data-test="rule-email-stats-Opened"]').should("contain.text", "2").and("contain.text", "67 %");
          cy.get('[data-test="rule-email-stats-Clicked"]').should("contain.text", "1").and("contain.text", "33 %");
          cy.get('[data-test="rule-email-stats-Bounced / failed"]').should("contain.text", "1");
        });
      });
    });
  });
});
