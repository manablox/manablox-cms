import type { PluginErrorKey, PluginErrorSpec } from '@manablox/core';

/** The workflows plugin's error keys and their English sentences. */
export const workflowErrors: Record<PluginErrorKey, PluginErrorSpec> = {
  'plugins.workflows.code.immutable': {
    kind: 'forbidden',
    message: 'This workflow is declared in code. Edit it there, or clone it here.',
  },
  'plugins.workflows.notFound': { kind: 'not_found', message: 'That workflow no longer exists.' },
  'plugins.workflows.validation.failed': {
    kind: 'validation',
    message: 'The workflow could not be saved - see the parts marked.',
  },
  'plugins.workflows.name.required': { message: 'A name is required.' },
  'plugins.workflows.trigger.eventsRequired': { message: 'Pick at least one event to start on.' },
  'plugins.workflows.trigger.eventUnknown': { message: 'The server does not know that event.' },
  'plugins.workflows.trigger.cronInvalid': {
    message: 'That schedule cannot be read - five fields: minute, hour, day, month, weekday.',
  },
  'plugins.workflows.trigger.timezoneInvalid': { message: 'That timezone is not known.' },
  'plugins.workflows.trigger.typeNotFound': {
    message: 'One of the content types no longer exists.',
  },
  'plugins.workflows.abort.tooMany': {
    message: 'A workflow can have at most {max} abort triggers.',
  },
  'plugins.workflows.trigger.parameterInvalid': {
    message: 'Name the value with letters, digits and underscores, starting with a letter.',
  },
  'plugins.workflows.trigger.parameterDuplicate': {
    message: 'Another value already goes by that name.',
  },
  'plugins.workflows.abort.eventsRequired': {
    message: 'Pick at least one event that aborts the run.',
  },
  'plugins.workflows.abort.eventUnknown': { message: 'That event cannot abort a run.' },
  'plugins.workflows.abort.keyRequired': {
    message: 'Matching by key needs a run key and an abort key.',
  },
  'plugins.workflows.abort.documentNeedsContent': {
    message: 'Matching the same document needs at least one content event.',
  },
  'plugins.workflows.abort.typeNotFound': { message: 'One of the content types no longer exists.' },
  'plugins.workflows.design.unavailable': {
    kind: 'not_found',
    message: 'Designing a workflow from a description is not available here.',
  },
  'plugins.workflows.import.invalid': { message: 'That file is not a workflow export.' },
  'plugins.workflows.import.versionUnsupported': {
    message: 'That workflow file is from a newer version.',
  },
  'plugins.workflows.nodes.required': { message: 'A workflow needs at least one node.' },
  'plugins.workflows.node.idDuplicate': {
    message: 'Two nodes share an id - remove one and add it again.',
  },
  'plugins.workflows.node.keyRequired': { message: 'Give the node a name templates can use.' },
  'plugins.workflows.node.keyInvalid': {
    message: 'Use lower-case letters, digits and underscores, starting with a letter.',
  },
  'plugins.workflows.node.keyDuplicate': { message: 'Another node already goes by that name.' },
  'plugins.workflows.node.unreachable': {
    message: 'Nothing leads here - join it up, or remove it.',
  },
  'plugins.workflows.node.kindUnknown': { message: 'The server does not know that kind of node.' },
  'plugins.workflows.edge.nodeUnknown': {
    message: 'That connection points at a node that is gone.',
  },
  'plugins.workflows.edge.portUnknown': {
    message: 'That connection leaves by a port this node does not have.',
  },
  'plugins.workflows.edge.selfLoop': { message: 'A node cannot lead back to itself.' },
  'plugins.workflows.edge.duplicate': {
    message: 'The same two nodes are already joined that way.',
  },
  'plugins.workflows.rule.operatorUnknown': {
    message: 'The server does not know that comparison.',
  },
  'plugins.workflows.graph.cycle': {
    message: 'These nodes lead back into each other, so the run would never end.',
  },
  'plugins.workflows.graph.startRequired': { message: 'Join at least one node to the trigger.' },
  'plugins.workflows.action.unknown': { message: 'No action of that kind is installed here.' },
  'plugins.workflows.action.duplicate': { message: 'Two actions claim the same name.' },
  'plugins.workflows.action.unavailable': { message: 'This instance cannot run that action.' },
  'plugins.workflows.action.credentialRequired': { message: 'Pick a credential for this action.' },
  'plugins.workflows.action.credentialKind': {
    message: 'That credential is not the kind this action needs.',
  },
  'plugins.workflows.reference.unknownNode': { message: 'No node goes by that name.' },
  'plugins.workflows.reference.notUpstream': {
    message: 'That node does not run before this one, so it has nothing to give it yet.',
  },
  'plugins.workflows.reference.outsideLoop': {
    message:
      'Only a node inside a loop has a current item; this one is not after a "For each item" line.',
  },
  'plugins.workflows.loop.enteredFromOutside': {
    message:
      'A line from outside the loop leads into its branch; the branch may only start from "For each item".',
  },
  'plugins.workflows.loop.waitInside': { message: 'A wait cannot be part of a loop.' },
  'plugins.workflows.call.targetRequired': { message: 'Pick the workflow to run.' },
  'plugins.workflows.call.targetNotFound': {
    message: 'That workflow no longer exists in this space.',
  },
  'plugins.workflows.call.targetNotCallable': {
    message:
      'That workflow does not start "When another workflow runs it", so it cannot be run from here.',
  },
  'plugins.workflows.call.inputRequired': { message: 'The workflow it runs needs this value.' },
  'plugins.workflows.call.inputUnknown': {
    message: 'The workflow it runs takes no value by that name.',
  },
  'plugins.workflows.node.crawl.urlInvalid': {
    message: 'Enter a full http(s) address to start from.',
  },
  'plugins.workflows.node.content.typeRequired': { message: 'Pick the type of document to write.' },
  'plugins.workflows.node.content.idRequired': { message: 'Say which document to update.' },
  'plugins.workflows.node.transform.templateInvalid': { message: 'That is not valid JSON.' },
  'plugins.workflows.node.mail.fromRequired': {
    message: 'The credential has no from address, so give one here.',
  },
  'plugins.workflows.run.timeout': { message: 'The run took too long and was stopped.' },
  'plugins.workflows.run.aborted': { message: 'The run was aborted.' },
  'plugins.workflows.run.notActive': { message: 'That run has already ended.' },
  'plugins.workflows.run.workflowGone': {
    message: 'The workflow was deleted before the run could start.',
  },
  'plugins.workflows.run.outputUnreadable': { message: 'The output could not be read: {reason}' },
  'plugins.workflows.run.actionMissing': {
    message: 'No action named "{action}" is installed on this instance.',
  },
  'plugins.workflows.run.delayInLoop': { message: 'A wait cannot run inside a loop.' },
  'plugins.workflows.run.waitInLoop': {
    message: 'This action wanted to wait, which it cannot do inside a loop.',
  },
  'plugins.workflows.run.loopNotList': { message: '"{template}" is not a list.' },
  'plugins.workflows.run.loopNoList': {
    message: 'The previous node handed over no list to go through.',
  },
  'plugins.workflows.run.loopItemFailed': { message: 'Item {item} failed: {reason}' },
  'plugins.workflows.run.loopCountInvalid': {
    message: '"{count}" is not a number of times to repeat.',
  },
  'plugins.workflows.run.stopped': { message: '{message}' },
  'plugins.workflows.run.callUnsupported': {
    message: 'This instance cannot run other workflows from a run.',
  },
  'plugins.workflows.run.callPausedInLoop': {
    message: '"{name}" paused, which a loop cannot wait for; it carries on by itself.',
  },
  'plugins.workflows.run.calledRunGone': { message: 'The run it started no longer exists.' },
  'plugins.workflows.run.calledRunFailed': { message: '"{name}" did not finish: {reason}' },
  'plugins.workflows.run.callTargetUnpublished': { message: '"{name}" is not published yet.' },
  'plugins.workflows.run.callTargetDisabled': { message: '"{name}" is switched off.' },
  'plugins.workflows.run.callCycle': {
    message: '"{name}" is already running further up this chain of calls.',
  },
  'plugins.workflows.run.callTooDeep': {
    message: 'Workflows may only call each other {max} deep.',
  },
  'plugins.workflows.run.callInputMissing': {
    message: '"{name}" needs a value for "{parameter}".',
  },
  'plugins.workflows.run.recipientMissing': {
    message: 'No recipient address came out of the fields given.',
  },
  'plugins.workflows.run.requestFailed': { message: '{method} {url} failed: {reason}' },
  'plugins.workflows.run.httpStatus': { message: '{method} {url} answered with HTTP {status}.' },
  'plugins.workflows.run.serviceStatus': {
    message: '{service} answered with HTTP {status}: {reason}',
  },
  'plugins.workflows.run.tokenMissing': { message: '{provider} handed back no access token.' },
  'plugins.workflows.run.pushFailed': { message: 'Every push failed: {reason}' },
  'plugins.workflows.run.crawlEmpty': { message: 'Nothing could be read from {url}. {reason}' },
  'plugins.workflows.run.pageStatus': { message: '{url} answered with HTTP {status}.' },
  'plugins.workflows.run.notAPage': { message: '{url} is {type}, not a page.' },
  'plugins.workflows.run.notADocument': {
    message: '"{from}" is not a document an earlier node wrote.',
  },
  'plugins.workflows.node.email.recipientRequired': {
    message: 'Add an address or pick a role to send to.',
  },
  'plugins.workflows.node.email.recipientInvalid': { message: 'That is not an email address.' },
  'plugins.workflows.node.email.subjectRequired': { message: 'A subject is required.' },
  'plugins.workflows.node.http.urlInvalid': { message: 'Enter a full http(s) address.' },
  'plugins.workflows.node.http.headerNameInvalid': { message: 'That is not a valid header name.' },
  'plugins.workflows.node.push.recipientRequired': { message: 'Pick who should be notified.' },
  'plugins.workflows.node.push.titleRequired': { message: 'A title is required.' },
  'plugins.workflows.node.condition.rulesRequired': { message: 'Add at least one rule.' },
  'plugins.workflows.node.condition.fieldRequired': {
    message: 'Say which value the rule looks at.',
  },
  'plugins.workflows.node.delay.minutesInvalid': {
    message: 'Wait between one minute and thirty days.',
  },
  'plugins.workflows.node.loop.maxItemsInvalid': { message: 'Take between 1 and 500 items.' },
  'plugins.workflows.node.loop.countRequired': { message: 'Say how many times to repeat.' },
  'plugins.workflows.node.switch.fieldRequired': { message: 'Say which value the cases compare.' },
  'plugins.workflows.node.switch.casesRequired': { message: 'Add at least one case.' },
  'plugins.workflows.node.switch.tooManyCases': { message: 'A switch takes at most {max} cases.' },
  'plugins.workflows.node.switch.caseIdInvalid': {
    message: 'A case needs a port name of lowercase letters, digits and _.',
  },
  'plugins.workflows.node.switch.caseIdDuplicate': {
    message: 'Two cases share the port name "{id}".',
  },
  'plugins.workflows.run.notFound': { kind: 'not_found', message: 'That run no longer exists.' },
  'plugins.workflows.run.createFailed': { message: 'The run could not be started.' },
  'plugins.workflows.run.documentRequired': {
    message: 'Pick a document to test this workflow against.',
  },
  'plugins.workflows.run.unpublished': { message: '"{name}" is not published yet.' },
  'plugins.workflows.run.notManual': {
    message: '"{name}" is not started by hand; its live version has another trigger.',
  },
  'plugins.workflows.run.disabled': { message: '"{name}" is switched off.' },
  'plugins.workflows.run.inputMissing': {
    message: 'Fill in "{parameter}"; the workflow needs it.',
  },
  'plugins.workflows.version.notFound': {
    kind: 'not_found',
    message: 'That version of the workflow does not exist.',
  },
  'plugins.workflows.create.failed': { message: 'The workflow could not be saved.' },
  'plugins.workflows.trigger.kindUnknown': {
    message: 'No installed plugin starts workflows this way ("{kind}").',
  },
  'plugins.workflows.abort.kindUnknown': {
    message: 'No installed plugin stops runs this way ("{kind}").',
  },
  'plugins.workflows.code.steps.required': { message: 'The workflow "{slug}" has no steps.' },
  'plugins.workflows.code.step.keyInvalid': {
    message:
      'The step key "{key}" of "{slug}" must be lowercase letters, digits and _, starting with a letter.',
  },
  'plugins.workflows.code.step.keyDuplicate': {
    message: 'Two steps of "{slug}" share the key "{key}".',
  },
  'plugins.workflows.code.step.targetUnknown': {
    message: 'The step "{key}" of "{slug}" leads to "{target}", which is not a step.',
  },
  'plugins.workflows.code.step.portRequired': {
    message: 'The step "{key}" of "{slug}" must name the port it follows from.',
  },
};
