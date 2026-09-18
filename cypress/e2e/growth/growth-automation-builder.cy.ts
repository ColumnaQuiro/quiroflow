// The delay node in the campaign builder.
//
// A sequence is only maintainable if staff can see it, so the engine's
// delay step needs a way in. The test that earns its place here is the
// exclusivity one: the action panels are a v-if chain, and the webhook
// branch used to be the catch-all `v-else` -- so a Wait step rendered its
// own fields AND the webhook's URL and signing-secret boxes underneath.
// Caught by looking at it, not by a type error, which is exactly the kind
// of thing that survives to production.

interface SeededAccount {
  email: string;
  password: string;
  accountId: string;
}

describe("Campaign builder: waiting", () => {
  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      const account = seeded as SeededAccount;
      cy.wrap(account.accountId).as("accountId");
      cy.login(account.email, account.password);
    });
    cy.visit("/campaigns");
    // Wait for the page to hydrate before clicking. A click on a
    // server-rendered button that Vue has not claimed yet does nothing at
    // all, and the failure looks like a missing modal rather than a race.
    cy.contains("No campaigns yet").should("be.visible");
    cy.contains("button", "New campaign").click();
    // exist, not be.visible: the modal body scrolls inside an
    // overflow-hidden container, so anything below the fold reads as hidden
    // even when it is rendered and clickable.
    cy.get('[data-test="action-type"]').should("exist");
  });

  it("offers a Wait step and shows only its own fields", () => {
    cy.get('[data-test="action-type"]').select("delay");

    cy.get('[data-test="delay-config"]')
      .scrollIntoView()
      .should("be.visible")
      .within(() => {
        cy.get('input[type="number"]').should("have.value", "1");
        cy.contains("before the next step").should("exist");
        // The limit named where it is decided, rather than left to be
        // discovered by someone whose 30-second wait became 15 minutes.
        cy.contains("checked every 15 minutes").should("exist");
      });

    // The regression: a Wait must not drag the webhook panel in with it.
    cy.contains("Signing secret").should("not.exist");
    cy.get('input[placeholder*="example.com"]').should("not.exist");
  });

  it("saves a wait in minutes, whatever unit was chosen", () => {
    cy.get('[data-test="action-type"]').select("delay");
    cy.get('[data-test="delay-config"]').within(() => {
      cy.get('input[type="number"]').clear().type("2");
      cy.get("select").select("hours");
    });
    cy.contains("button", "Save campaign").click();

    // Two hours is stored as 120 minutes: one unit underneath, because the
    // cron that runs it thinks in minutes and a second unit in the database
    // would be two ways to say the same thing.
    cy.get<string>("@accountId").then((accountId) => {
      cy.task("db:latestAutomationActions", { accountId }).then((rows) => {
        const actions = rows as {
          action_type: string;
          config: { delay_minutes?: number };
        }[];
        const delay = actions.find((a) => a.action_type === "delay");
        expect(delay, "a delay action").to.not.be.undefined;
        expect(delay!.config.delay_minutes).to.eq(120);
      });
    });
  });

  it("asks for a header only when the template declares one", () => {
    // Stubbed at the network edge rather than seeded, because the template
    // list comes from Meta and a test account has no WhatsApp credentials --
    // without this the list is empty and the assertions would be passing
    // against a vacuum rather than against the branch logic.
    cy.intercept("GET", "**/api/whatsapp/templates*", {
      body: {
        templates: [
          {
            name: "plain_message",
            language: "es",
            category: "MARKETING",
            bodyText: "Hola {{1}}",
            variableCount: 1,
            urlButtonCount: 0,
            mediaHeaderFormat: null,
          },
          {
            name: "with_location",
            language: "es",
            category: "MARKETING",
            bodyText: "Aquí estamos",
            variableCount: 0,
            urlButtonCount: 0,
            mediaHeaderFormat: "LOCATION",
          },
          {
            name: "with_video",
            language: "en",
            category: "MARKETING",
            bodyText: "Hi {{1}}",
            variableCount: 1,
            urlButtonCount: 0,
            mediaHeaderFormat: "VIDEO",
          },
        ],
      },
    }).as("templates");

    // Reopen so the modal loads the stubbed list.
    cy.contains("button", "Cancel").click();
    cy.contains("button", "New campaign").click();
    cy.wait("@templates");

    cy.get('[data-test="template-select"]').select("plain_message::es");
    cy.get('[data-test="header-location"]').should("not.exist");
    cy.get('[data-test="header-media"]').should("not.exist");

    cy.get('[data-test="template-select"]').select("with_location::es");
    cy.get('[data-test="header-location"]')
      .scrollIntoView()
      .should("be.visible");
    cy.get('[data-test="header-media"]').should("not.exist");

    cy.get('[data-test="template-select"]').select("with_video::en");
    cy.get('[data-test="header-media"]').scrollIntoView().should("be.visible");
    cy.get('[data-test="header-location"]').should("not.exist");
  });

  it("says why a test send failed instead of just that it did", () => {
    // "Send test to me" answered every failure with "Failed to send test.",
    // because the catch in AutomationModal replaced whatever the server said
    // with a fixed string -- and underneath it runEmailAction swallowed the
    // Resend error too, and returned silently when no API key was configured
    // at all. A staff member with a campaign that would never send had no way
    // to find out why, and neither did anyone they reported it to.
    //
    // No Resend key is configured against the test environment, which is one
    // of the reasons the old code turned into silence. It now names it.
    cy.get('[data-test="action-type"]').select("email");
    cy.get('[data-test="email-subject"]').scrollIntoView().type("Prueba");
    cy.get('[data-test="email-body"]').scrollIntoView().type("Hola");

    cy.contains("button", "Send test to me").click();

    cy.contains("Failed to send test.").should("not.exist");
    cy.contains("not configured").should("be.visible");
  });

  it("offers a test run that records instead of sending", () => {
    cy.get('[data-test="dry-run-toggle"]')
      .scrollIntoView()
      .should("have.attr", "aria-checked", "false")
      .click();
    cy.get('[data-test="dry-run-toggle"]').should(
      "have.attr",
      "aria-checked",
      "true",
    );
    cy.contains("records what it would have sent instead of sending it").should(
      "exist",
    );
  });
});
